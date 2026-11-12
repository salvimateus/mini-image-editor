import type { Mask } from '../mask.ts';
import { PARAMS } from '../params/index.ts';
import type { Point, RasterImage } from '../types.ts';

/** Options of a full filter run. */
export interface AdjustRunOptions {
  /** Called with 0..1 while the filter runs. */
  onProgress?: (ratio: number) => void;
  /** Free cache between runs on the same source (the handler keeps it in the session). */
  cache?: Map<string, unknown>;
  /** A key of the source in `cache` (for example 'proxy' or 'full'); without it nothing is cached. */
  cacheKey?: string;
  /** Pixel size of the source in layer px (a proxy has less than 1 layer px per pixel); radii scale with it. */
  pixelScale?: number;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

export function luma(r: number, g: number, b: number): number {
  const { luma: w } = PARAMS.adjust;
  return w.r * r + w.g * g + w.b * b;
}

/** Calls `onProgress` at most PARAMS.adjust.progressSteps times over `rows` rows. */
export function rowProgress(rows: number, onProgress?: (ratio: number) => void): (row: number) => void {
  if (!onProgress || rows <= 0) return () => {};
  const every = Math.max(1, Math.ceil(rows / PARAMS.adjust.progressSteps));
  return (row) => {
    if (row % every === 0) onProgress(row / rows);
  };
}

/**
 * The coverage of each pixel of an image whose pixel (0, 0) sits at `offset` on the document mask, or null when the
 * mask is null (everything). Outside the mask the coverage is 0.
 */
export function coverageOf(mask: Mask | null, width: number, height: number, offset: Point): Uint8Array | null {
  if (!mask) return null;
  const out = new Uint8Array(width * height);
  const ox = Math.round(offset.x);
  const oy = Math.round(offset.y);
  const x0 = Math.max(0, -ox);
  const x1 = Math.min(width, mask.width - ox);
  if (x1 <= x0) return out;
  for (let y = Math.max(0, -oy); y < Math.min(height, mask.height - oy); y++) {
    const from = (y + oy) * mask.width + x0 + ox;
    out.set(mask.data.subarray(from, from + (x1 - x0)), y * width + x0);
  }
  return out;
}

/**
 * The coverage plane of a proxy (pw x ph) of a source (width x height at `offset` on the mask): the box average of the
 * mask under each proxy pixel. Null when the mask is null.
 */
export function proxyCoverage(mask: Mask | null, width: number, height: number, offset: Point, pw: number, ph: number): Uint8Array | null {
  const full = coverageOf(mask, width, height, offset);
  if (!full) return null;
  const out = new Uint8Array(pw * ph);
  const sx = width / pw;
  const sy = height / ph;
  for (let py = 0; py < ph; py++) {
    const y0 = Math.floor(py * sy);
    const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil((py + 1) * sy)));
    for (let px = 0; px < pw; px++) {
      const x0 = Math.floor(px * sx);
      const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil((px + 1) * sx)));
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) sum += full[row + x];
      }
      out[py * pw + px] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return out;
}

/** True when no pixel has coverage: the filter cannot change anything. */
export function isEmptyCoverage(cover: Uint8Array | null): boolean {
  if (!cover) return false;
  for (let i = 0; i < cover.length; i++) if (cover[i] !== 0) return false;
  return true;
}

/**
 * Blends the filtered RGB of `out` back toward `src` by the coverage, in place. Alpha always stays the source alpha.
 */
export function blendByCoverage(src: RasterImage, out: RasterImage, cover: Uint8Array | null): void {
  const s = src.data;
  const d = out.data;
  if (!cover) {
    for (let i = 3; i < d.length; i += 4) d[i] = s[i];
    return;
  }
  for (let p = 0, i = 0; p < cover.length; p++, i += 4) {
    const c = cover[p];
    if (c === 255) {
      d[i + 3] = s[i + 3];
      continue;
    }
    if (c === 0) {
      d[i] = s[i];
      d[i + 1] = s[i + 1];
      d[i + 2] = s[i + 2];
      d[i + 3] = s[i + 3];
      continue;
    }
    const k = c / 255;
    d[i] = s[i] + (d[i] - s[i]) * k;
    d[i + 1] = s[i + 1] + (d[i + 1] - s[i + 1]) * k;
    d[i + 2] = s[i + 2] + (d[i + 2] - s[i + 2]) * k;
    d[i + 3] = s[i + 3];
  }
}
