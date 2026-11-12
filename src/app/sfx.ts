import { TUNING } from './tuning/index.ts';
import { readStored, writeStored } from './storage.ts';

export type SoundName =
  | 'open'
  | 'tick'
  | 'tool'
  | 'paint'
  | 'erase'
  | 'stamp'
  | 'fill'
  | 'pick'
  | 'snap'
  | 'select'
  | 'delete'
  | 'layer'
  | 'undo'
  | 'redo'
  | 'crop'
  | 'resize'
  | 'apply'
  | 'cancel'
  | 'saved'
  | 'error';

const MUTE_KEY = 'mute';

interface ToneSpec {
  freq: number;
  to?: number;
  at?: number;
  dur: number;
  type?: OscillatorType;
  vol?: number;
}

interface NoiseSpec {
  at?: number;
  dur: number;
  vol: number;
  cutoff: number;
  filter?: BiquadFilterType;
}

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = readStored(MUTE_KEY) === '1';
/** Contexts that failed to start or closed: after a few, the app stays silent instead of retrying on each gesture. */
let failures = 0;
const lastPlayed = new Map<SoundName, number>();

/** Drops a context that broke (no audio device, device removed): the next gesture can build a new one. */
function dropContext(): void {
  const old = context;
  context = null;
  master = null;
  failures += 1;
  if (old && old.state !== 'closed') old.close().catch(() => undefined);
}

function resume(ctx: AudioContext): void {
  if (ctx.state === 'running') return;
  try {
    ctx.resume().catch(() => undefined);
  } catch {
    dropContext();
  }
}

function unlock(): void {
  if (context) {
    if (context.state === 'closed') dropContext();
    else {
      resume(context);
      return;
    }
  }
  if (failures >= TUNING.sfx.maxContextFailures || typeof AudioContext === 'undefined') return;
  try {
    const ctx = new AudioContext();
    const out = ctx.createGain();
    out.gain.value = muted ? 0 : TUNING.sfx.master;
    // A soft limiter: chords and fast repeats never clip, so every recipe keeps its balance.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 10;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    out.connect(limiter).connect(ctx.destination);
    ctx.addEventListener('statechange', () => {
      if (ctx === context && ctx.state === 'closed') dropContext();
    });
    // Chrome fires `error` when the audio device fails; the context then never runs.
    ctx.addEventListener('error', () => {
      if (ctx === context) dropContext();
    });
    context = ctx;
    master = out;
    resume(ctx);
  } catch {
    dropContext();
  }
}

/** The browser allows audio only after a user gesture, so the context starts on the first one. */
export function installAudioUnlock(): void {
  const options = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', unlock, options);
  window.addEventListener('keydown', unlock, options);
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  writeStored(MUTE_KEY, value ? '1' : '0');
  if (!master || !context) return;
  try {
    master.gain.setTargetAtTime(value ? 0 : TUNING.sfx.master, context.currentTime, 0.02);
  } catch {
    dropContext();
  }
}

function tone(ctx: AudioContext, out: AudioNode, spec: ToneSpec): void {
  const start = ctx.currentTime + (spec.at ?? 0);
  const end = start + spec.dur;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = spec.type ?? 'triangle';
  osc.frequency.setValueAtTime(spec.freq, start);
  if (spec.to) osc.frequency.exponentialRampToValueAtTime(spec.to, end);
  const peak = spec.vol ?? 0.2;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.008, spec.dur / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(end + 0.02);
}

function noise(ctx: AudioContext, out: AudioNode, spec: NoiseSpec): void {
  if (!noiseBuffer || noiseBuffer.sampleRate !== ctx.sampleRate) {
    noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = Math.random() * 2 - 1;
  }
  const start = ctx.currentTime + (spec.at ?? 0);
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  // A random start in the buffer: fast repeats do not sound like one loop.
  const offset = Math.random() * Math.max(0, noiseBuffer.duration - spec.dur - 0.03);
  const filter = ctx.createBiquadFilter();
  filter.type = spec.filter ?? 'lowpass';
  filter.frequency.value = spec.cutoff;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(spec.vol, start + Math.min(0.006, spec.dur / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + spec.dur);
  source.connect(filter).connect(gain).connect(out);
  source.start(start, offset);
  source.stop(start + spec.dur + 0.02);
}

const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const C6 = 1046.5;
const E6 = 1318.51;
const G6 = 1567.98;

/**
 * One short recipe for each sound. The fast ones (paint, erase, tick, snap) stay quiet and short; the rare ones
 * (open, apply, saved) are small chords in C major, so they sound like one family.
 */
const recipes: Record<SoundName, (ctx: AudioContext, out: AudioNode) => void> = {
  open(ctx, out) {
    noise(ctx, out, { dur: 0.06, vol: 0.06, cutoff: 2400 });
    [C5, E5, G5].forEach((freq, i) => tone(ctx, out, { freq, at: i * 0.055, dur: 0.1, vol: 0.12 }));
    tone(ctx, out, { freq: C6, at: 0.165, dur: 0.26, type: 'sine', vol: 0.14 });
  },
  tick(ctx, out) {
    tone(ctx, out, { freq: 1480, dur: 0.018, type: 'sine', vol: 0.06 });
  },
  tool(ctx, out) {
    tone(ctx, out, { freq: A5, to: 1180, dur: 0.055, type: 'sine', vol: 0.12 });
    tone(ctx, out, { freq: 1760, at: 0.02, dur: 0.04, type: 'sine', vol: 0.03 });
  },
  paint(ctx, out) {
    const freq = 560 + Math.random() * 160;
    tone(ctx, out, { freq, to: freq * 1.15, dur: 0.04, type: 'sine', vol: 0.045 });
    noise(ctx, out, { dur: 0.035, vol: 0.02, cutoff: 2200, filter: 'bandpass' });
  },
  erase(ctx, out) {
    noise(ctx, out, { dur: 0.055, vol: 0.06, cutoff: 1400 });
    tone(ctx, out, { freq: 380 + Math.random() * 60, to: 220, dur: 0.05, type: 'sine', vol: 0.03 });
  },
  stamp(ctx, out) {
    tone(ctx, out, { freq: 180, to: 90, dur: 0.1, type: 'sine', vol: 0.22 });
    noise(ctx, out, { dur: 0.03, vol: 0.08, cutoff: 900 });
    tone(ctx, out, { freq: E5, at: 0.035, dur: 0.07, type: 'sine', vol: 0.05 });
  },
  fill(ctx, out) {
    tone(ctx, out, { freq: 300, to: 980, dur: 0.18, type: 'sine', vol: 0.16 });
    tone(ctx, out, { freq: 600, to: 1460, at: 0.04, dur: 0.15, type: 'sine', vol: 0.05 });
    noise(ctx, out, { at: 0.02, dur: 0.12, vol: 0.03, cutoff: 1800 });
  },
  pick(ctx, out) {
    tone(ctx, out, { freq: E6, dur: 0.04, type: 'sine', vol: 0.11 });
    tone(ctx, out, { freq: G6, at: 0.045, dur: 0.06, type: 'sine', vol: 0.09 });
  },
  snap(ctx, out) {
    tone(ctx, out, { freq: 1900, dur: 0.01, type: 'square', vol: 0.015 });
    tone(ctx, out, { freq: 1200, dur: 0.028, type: 'sine', vol: 0.06 });
  },
  select(ctx, out) {
    tone(ctx, out, { freq: C5, to: G5, dur: 0.07, type: 'sine', vol: 0.12 });
    tone(ctx, out, { freq: G5, to: C6, at: 0.05, dur: 0.06, type: 'sine', vol: 0.05 });
  },
  delete(ctx, out) {
    noise(ctx, out, { dur: 0.1, vol: 0.08, cutoff: 1500 });
    tone(ctx, out, { freq: 480, to: 170, dur: 0.13, vol: 0.1 });
  },
  layer(ctx, out) {
    tone(ctx, out, { freq: G5, dur: 0.06, vol: 0.1 });
    tone(ctx, out, { freq: C6, at: 0.055, dur: 0.09, type: 'sine', vol: 0.12 });
  },
  undo(ctx, out) {
    tone(ctx, out, { freq: 700, to: 480, dur: 0.065, type: 'sine', vol: 0.12 });
    tone(ctx, out, { freq: 1400, to: 960, dur: 0.04, type: 'sine', vol: 0.025 });
  },
  redo(ctx, out) {
    tone(ctx, out, { freq: 480, to: 700, dur: 0.065, type: 'sine', vol: 0.12 });
    tone(ctx, out, { freq: 960, to: 1400, dur: 0.04, type: 'sine', vol: 0.025 });
  },
  crop(ctx, out) {
    [0, 0.065].forEach((at) => {
      noise(ctx, out, { at, dur: 0.03, vol: 0.09, cutoff: 3600, filter: 'highpass' });
      tone(ctx, out, { freq: 1600, to: 900, at, dur: 0.03, type: 'sine', vol: 0.04 });
    });
    tone(ctx, out, { freq: G5, at: 0.11, dur: 0.09, type: 'sine', vol: 0.1 });
  },
  resize(ctx, out) {
    tone(ctx, out, { freq: 320, to: 880, dur: 0.16, type: 'sine', vol: 0.14 });
    tone(ctx, out, { freq: 640, to: 1760, at: 0.03, dur: 0.13, type: 'sine', vol: 0.035 });
  },
  apply(ctx, out) {
    [E5, G5, C6].forEach((freq, i) => tone(ctx, out, { freq, at: i * 0.02, dur: 0.18, vol: 0.07 }));
    tone(ctx, out, { freq: E6, at: 0.08, dur: 0.18, type: 'sine', vol: 0.07 });
  },
  cancel(ctx, out) {
    tone(ctx, out, { freq: D5, to: 440, dur: 0.07, type: 'sine', vol: 0.09 });
    tone(ctx, out, { freq: 392, at: 0.06, dur: 0.07, type: 'sine', vol: 0.06 });
  },
  saved(ctx, out) {
    [C5, E5, G5, C6].forEach((freq, i) => tone(ctx, out, { freq, at: i * 0.08, dur: 0.11, vol: 0.11 }));
    [C6, E6, G6].forEach((freq) => tone(ctx, out, { freq, at: 0.34, dur: 0.45, type: 'sine', vol: 0.07 }));
  },
  error(ctx, out) {
    tone(ctx, out, { freq: 233, to: 208, dur: 0.11, vol: 0.13 });
    tone(ctx, out, { freq: 175, to: 156, at: 0.12, dur: 0.16, vol: 0.13 });
  },
};

const minIntervalMs: Partial<Record<SoundName, number>> = TUNING.sfx.minIntervalMs;

/** Plays one sound. A missing, suspended or broken audio device never throws and never blocks the action. */
export function play(name: SoundName): void {
  if (muted || !context || !master) return;
  if (context.state !== 'running') {
    if (context.state === 'closed') dropContext();
    return;
  }
  const now = performance.now();
  const interval = minIntervalMs[name];
  if (interval !== undefined && now - (lastPlayed.get(name) ?? -Infinity) < interval) return;
  lastPlayed.set(name, now);
  try {
    recipes[name](context, master);
  } catch {
    dropContext();
  }
}
