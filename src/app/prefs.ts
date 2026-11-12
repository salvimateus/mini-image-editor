import type { Rgba } from '../core/types.ts';
import { clearStored, readStored, writeStored } from './storage.ts';

// Stored settings: one key per feature, each a JSON object with a version field `v`. A read checks and clamps each
// field, so a broken, missing or old value gives the default and never throws. A write waits a short time and
// skips a value that is already stored, so a slider drag writes once when it rests.

export type Fields = Record<string, unknown>;

const WRITE_DELAY_MS = 400;

const pending = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;
const resetters: (() => void)[] = [];

function record(value: unknown): Fields | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Fields) : null;
}

/** The parsed JSON of a key (a value that waits to be written counts), or null when it is missing or broken. */
export function readJson(key: string): unknown {
  const text = pending.get(key) ?? readStored(key);
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The fields of a key at `version`; null when the key is missing, broken or of another version. No `v` counts as 1. */
export function readPrefs(key: string, version: number): Fields | null {
  const value = record(readJson(key));
  if (!value) return null;
  const v = value.v ?? 1;
  return v === version ? value : null;
}

/** Stores the fields with their version, after a short delay; a value equal to the stored one is not written. */
export function savePrefs(key: string, version: number, fields: object): void {
  saveText(key, JSON.stringify({ v: version, ...fields }));
}

/** Stores a raw JSON value (a list), with the same delay and the same check as `savePrefs`. */
export function saveJson(key: string, value: unknown): void {
  saveText(key, JSON.stringify(value));
}

function saveText(key: string, text: string): void {
  pending.set(key, text);
  if (timer === null) timer = setTimeout(flushPrefs, WRITE_DELAY_MS);
}

/** Writes the waiting values now: before the window closes or the page goes away. */
export function flushPrefs(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  for (const [key, text] of pending) {
    if (readStored(key) !== text) writeStored(key, text);
  }
  pending.clear();
}

/** `reset` puts the defaults back in the state of a feature; `resetPrefs` calls it. */
export function onPrefsReset(reset: () => void): void {
  resetters.push(reset);
}

/** Every stored setting goes back to its default: the live state now, and the storage is empty after it. */
export function resetPrefs(): void {
  for (const reset of resetters) {
    try {
      reset();
    } catch {
      // One feature that fails to reset must not stop the others.
    }
  }
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending.clear();
  clearStored();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPrefs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPrefs();
  });
}

// ----- field checks -----

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A finite number in the range, else the fallback; whole when `round` is set. */
export function numField(value: unknown, fallback: number, range: { min: number; max: number }, round = false): number {
  const n = clamp(typeof value === 'number' && Number.isFinite(value) ? value : fallback, range.min, range.max);
  return round ? Math.round(n) : n;
}

export function boolField(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function pickField<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A color with whole channels in 0..255; alpha 255 when `opaque` is set. */
export function colorField(value: unknown, fallback: Rgba, opaque = false): Rgba {
  const c = record(value);
  if (!c) return { ...fallback, a: opaque ? 255 : fallback.a };
  const byte = (key: keyof Rgba) => numField(c[key], fallback[key], { min: 0, max: 255 }, true);
  return { r: byte('r'), g: byte('g'), b: byte('b'), a: opaque ? 255 : byte('a') };
}
