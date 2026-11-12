import { PARAMS } from '../params/index.ts';
import { createRaster } from '../raster.ts';
import type { RasterImage, VignetteParams } from '../types.ts';
import { clamp, rowProgress } from './common.ts';

/** Ranges of the vignette params. amount < 0 darkens (black), > 0 lightens (white). */
export const VIGNETTE_RANGES = {
  amount: { min: -100, max: 100 },
  size: { min: 0, max: 100 },
  roundness: { min: -100, max: 100 },
  feather: { min: 0, max: 100 },
} as const;

export function cleanVignette(params: VignetteParams): VignetteParams {
  const fix = (value: number, range: { min: number; max: number }, fallback: number) =>
    Math.round(clamp(Number.isFinite(value) ? value : fallback, range.min, range.max));
  return {
    amount: fix(params.amount, VIGNETTE_RANGES.amount, 0),
    size: fix(params.size, VIGNETTE_RANGES.size, 50),
    roundness: fix(params.roundness, VIGNETTE_RANGES.roundness, 0),
    feather: fix(params.feather, VIGNETTE_RANGES.feather, 50),
  };
}

export function sameVignette(a: VignetteParams, b: VignetteParams): boolean {
  return a.amount === b.amount && a.size === b.size && a.roundness === b.roundness && a.feather === b.feather;
}

/** The ordered dither matrix (Bayer), values in [0, 1). */
function bayer(size: number): Float32Array {
  let matrix = [0];
  let side = 1;
  while (side < size) {
    const next = new Array<number>(side * 2 * side * 2);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const v = matrix[y * side + x] * 4;
        next[y * side * 2 + x] = v;
        next[y * side * 2 + x + side] = v + 2;
        next[(y + side) * side * 2 + x] = v + 3;
        next[(y + side) * side * 2 + x + side] = v + 1;
      }
    }
    matrix = next;
    side *= 2;
  }
  const levels = side * side;
  return Float32Array.from(matrix, (v) => (v + 0.5) / levels);
}

/** |(i + 0.5 - n / 2) / axis| ^ exponent for each of n pixel centers, equal for i and n - 1 - i. */
function mirroredTerms(n: number, axis: number, exponent: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < Math.ceil(n / 2); i++) {
    const value = Math.pow(Math.abs((n / 2 - i - 0.5) / axis), exponent);
    out[i] = value;
    out[n - 1 - i] = value;
  }
  return out;
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * A black (amount < 0) or white (amount > 0) image at stage size. Its alpha is 0 inside the inner edge and grows toward
 * the corners. Roundness 0 follows the ellipse of the stage, +100 a circle, -100 a near rectangle. An ordered dither on
 * the alpha prevents banding. The dither matrix is mirrored about the center, so the image keeps both symmetries.
 */
export function renderVignette(width: number, height: number, params: VignetteParams, onProgress?: (ratio: number) => void): RasterImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const p = cleanVignette(params);
  const tone = p.amount < 0 ? 0 : 255;
  const image = createRaster(w, h, { r: tone, g: tone, b: tone, a: 0 });
  const strength = Math.abs(p.amount) / 100;
  if (strength === 0) return image;
  const q = PARAMS.adjust.vignette;
  const round = p.roundness / 100;
  const ax0 = w / 2;
  const ay0 = h / 2;
  const radius = Math.sqrt(ax0 * ay0);
  const blend = Math.max(0, round);
  const ax = ax0 + (radius - ax0) * blend;
  const ay = ay0 + (radius - ay0) * blend;
  const exponent = round < 0 ? 2 + (q.squareExponent - 2) * -round : 2;
  const inner = q.innerAtSize0 + (q.innerAtSize100 - q.innerAtSize0) * (p.size / 100);
  const feather = q.featherMin + (q.featherMax - q.featherMin) * (p.feather / 100);
  const dither = bayer(q.ditherSize);
  const side = q.ditherSize;
  const data = image.data;
  const tick = rowProgress(h, onProgress);
  // Each term is computed once for a pixel and its mirror, so the two get exactly the same value.
  const colTerm = mirroredTerms(w, ax, exponent);
  const rowTerms = mirroredTerms(h, ay, exponent);
  for (let y = 0; y < h; y++) {
    tick(y);
    const rowTerm = rowTerms[y];
    const dy = Math.min(y, h - 1 - y) % side;
    let i = y * w * 4 + 3;
    for (let x = 0; x < w; x++, i += 4) {
      const distance = Math.pow(colTerm[x] + rowTerm, 1 / exponent);
      if (distance <= inner) continue;
      const alpha = strength * smoothstep((distance - inner) / feather) * 255;
      const dx = Math.min(x, w - 1 - x) % side;
      data[i] = Math.floor(alpha + dither[dy * side + dx]);
    }
  }
  return image;
}
