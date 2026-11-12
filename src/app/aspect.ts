import { PARAMS } from '../core/params/index.ts';
import type { Rect } from '../core/types.ts';
import { formatDecimal } from './i18n/index.ts';

export interface RatioPreset { id: string; w: number; h: number; main: boolean }

/** The main presets show as buttons; the others live in the "Mais" menu. */
export const RATIO_PRESETS: readonly RatioPreset[] = [
  { id: '1:1', w: 1, h: 1, main: true },
  { id: '4:5', w: 4, h: 5, main: true },
  { id: '3:2', w: 3, h: 2, main: true },
  { id: '4:3', w: 4, h: 3, main: true },
  { id: '16:9', w: 16, h: 9, main: true },
  { id: '9:16', w: 9, h: 16, main: true },
  { id: '2:3', w: 2, h: 3, main: false },
  { id: '3:4', w: 3, h: 4, main: false },
  { id: '5:4', w: 5, h: 4, main: false },
  { id: '21:9', w: 21, h: 9, main: false },
  { id: '1.91:1', w: 1.91, h: 1, main: false },
  { id: '2:1', w: 2, h: 1, main: false },
];

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

function decimalTerm(value: number): string {
  return Number.isInteger(value) ? String(value) : formatDecimal(value);
}

/** The visible text of a preset, with the decimal mark of the UI language ('1,91:1'). */
export function presetLabel(preset: RatioPreset): string {
  return `${decimalTerm(preset.w)}:${decimalTerm(preset.h)}`;
}

/**
 * The status bar label: an exact preset or a small reduced ratio ('16:9', '7:5'); near a preset, '≈ 4:5'; else a
 * decimal ratio to 1 ('1,06:1', or '1:1,06' for a tall image). `preset` is the id of the matching or near preset.
 */
export function ratioLabel(w: number, h: number): { text: string; preset: string | null } {
  const width = Math.round(w);
  const height = Math.round(h);
  if (width <= 0 || height <= 0) return { text: '', preset: null };
  const ratio = width / height;
  for (const preset of RATIO_PRESETS) {
    // Exact in integers: width * h = height * w, with the decimal presets scaled to integers.
    if (Math.abs(width * preset.h * 100 - height * preset.w * 100) < 1e-6) return { text: presetLabel(preset), preset: preset.id };
  }
  const divisor = gcd(width, height);
  const a = width / divisor;
  const b = height / divisor;
  if (a <= PARAMS.aspect.maxExactTerm && b <= PARAMS.aspect.maxExactTerm) return { text: `${a}:${b}`, preset: null };
  let near: RatioPreset | null = null;
  let nearDistance = Infinity;
  for (const preset of RATIO_PRESETS) {
    const distance = Math.abs(ratio / (preset.w / preset.h) - 1);
    if (distance < nearDistance) {
      near = preset;
      nearDistance = distance;
    }
  }
  if (near && nearDistance <= PARAMS.aspect.nearTolerance) return { text: `≈ ${presetLabel(near)}`, preset: near.id };
  const text = ratio >= 1 ? `${formatDecimal(ratio)}:1` : `1:${formatDecimal(1 / ratio)}`;
  return { text, preset: null };
}

/**
 * A box of the ratio, centered on the stage, in stage px. 'crop': the largest box inside the stage. 'expand': the
 * smallest box that holds the stage (it leaves the stage).
 */
export function fitRatio(stageW: number, stageH: number, ratioW: number, ratioH: number, mode: 'crop' | 'expand'): Rect {
  const ratio = ratioW / ratioH;
  if (!(ratio > 0) || !Number.isFinite(ratio) || stageW <= 0 || stageH <= 0) return { x: 0, y: 0, w: Math.max(1, stageW), h: Math.max(1, stageH) };
  const wider = stageW / stageH > ratio;
  let w: number;
  let h: number;
  if (mode === 'crop') {
    if (wider) {
      h = stageH;
      w = Math.round(h * ratio);
    } else {
      w = stageW;
      h = Math.round(w / ratio);
    }
  } else if (wider) {
    w = stageW;
    h = Math.round(w / ratio);
  } else {
    h = stageH;
    w = Math.round(h * ratio);
  }
  w = Math.max(1, w);
  h = Math.max(1, h);
  return { x: Math.round((stageW - w) / 2), y: Math.round((stageH - h) / 2), w, h };
}
