import { PARAMS } from '../params/index.ts';
import type { RasterImage, SharpenParams } from '../types.ts';
import { clamp, luma, rowProgress, type AdjustRunOptions } from './common.ts';

export function cleanSharpen(params: SharpenParams): SharpenParams {
  const { maxSteps, radius, threshold } = PARAMS.adjust.sharpen;
  return {
    steps: Math.round(clamp(Number.isFinite(params.steps) ? params.steps : 0, 0, maxSteps)),
    radius: clamp(Number.isFinite(params.radius) ? params.radius : radius.default, radius.min, radius.max),
    threshold: clamp(Number.isFinite(params.threshold) ? params.threshold : threshold.default, threshold.min, threshold.max),
  };
}

export function isSharpenIdentity(params: SharpenParams): boolean {
  return cleanSharpen(params).steps === 0;
}

/** Half width in px of the blur kernel of a sigma. The region previews read this much more around the region. */
export function sharpenReach(sigma: number): number {
  return Math.max(1, Math.ceil(sigma * PARAMS.adjust.sharpen.kernelSigmas));
}

function gaussianKernel(sigma: number): Float32Array {
  const half = sharpenReach(sigma);
  const kernel = new Float32Array(half * 2 + 1);
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + half] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}

/** One separable pass over two planes at once, with the edge pixels repeated outside the image. */
function blurPass(a: Float32Array, b: Float32Array, width: number, height: number, kernel: Float32Array, horizontal: boolean): [Float32Array, Float32Array] {
  const half = (kernel.length - 1) / 2;
  const outA = new Float32Array(a.length);
  const outB = new Float32Array(b.length);
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const stride = horizontal ? 1 : width;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * width : line;
    for (let i = 0; i < length; i++) {
      let sa = 0;
      let sb = 0;
      for (let k = -half; k <= half; k++) {
        const j = i + k < 0 ? 0 : i + k >= length ? length - 1 : i + k;
        const w = kernel[k + half];
        const at = base + j * stride;
        sa += a[at] * w;
        sb += b[at] * w;
      }
      const at = base + i * stride;
      outA[at] = sa;
      outB[at] = sb;
    }
  }
  return [outA, outB];
}

/**
 * The luminance detail of the unsharp mask: luma minus its Gaussian blur. The blur weights each pixel by its alpha, so
 * the hidden color of transparent pixels never leaks into the edges.
 */
export function sharpenDetail(src: RasterImage, sigma: number, onProgress?: (ratio: number) => void): Float32Array {
  const { width, height } = src;
  const s = src.data;
  const count = width * height;
  const y = new Float32Array(count);
  const weighted = new Float32Array(count);
  const alpha = new Float32Array(count);
  for (let p = 0, i = 0; p < count; p++, i += 4) {
    const a = s[i + 3] / 255;
    const value = luma(s[i], s[i + 1], s[i + 2]);
    y[p] = value;
    weighted[p] = value * a;
    alpha[p] = a;
  }
  onProgress?.(0.15);
  const kernel = gaussianKernel(sigma);
  const [hw, ha] = blurPass(weighted, alpha, width, height, kernel, true);
  onProgress?.(0.45);
  const [bw, ba] = blurPass(hw, ha, width, height, kernel, false);
  onProgress?.(0.75);
  const detail = y;
  for (let p = 0; p < count; p++) detail[p] = ba[p] > 1e-6 ? y[p] - bw[p] / ba[p] : 0;
  return detail;
}

/** The sharpened image from a detail plane. Each step adds the same strength, always on the source pixels. */
export function applySharpenDetail(src: RasterImage, detail: Float32Array, params: SharpenParams, onProgress?: (ratio: number) => void): RasterImage {
  const p = cleanSharpen(params);
  const amount = p.steps * PARAMS.adjust.sharpen.amountPerStep;
  const { width, height } = src;
  const s = src.data;
  const d = s.slice();
  const tick = rowProgress(height, onProgress);
  let at = 0;
  for (let row = 0; row < height; row++) {
    tick(row);
    for (let x = 0; x < width; x++, at++) {
      const i = at * 4;
      if (s[i + 3] === 0) continue;
      const v = detail[at];
      if (v < p.threshold && v > -p.threshold) continue;
      const delta = v * amount;
      d[i] = s[i] + delta;
      d[i + 1] = s[i + 1] + delta;
      d[i + 2] = s[i + 2] + delta;
    }
  }
  return { width, height, data: d };
}

/** Sigma of the blur on this image: the radius in layer px, smaller on a proxy. */
export function sharpenSigma(params: SharpenParams, pixelScale = 1): number {
  return Math.max(0.2, cleanSharpen(params).radius * pixelScale);
}

export function applySharpen(src: RasterImage, params: SharpenParams, options: AdjustRunOptions = {}): RasterImage {
  const { cache, cacheKey, onProgress } = options;
  const sigma = sharpenSigma(params, options.pixelScale);
  const key = cacheKey === undefined ? null : `sharpen:${cacheKey}:${sigma}`;
  let detail = key && cache ? (cache.get(key) as Float32Array | undefined) : undefined;
  if (!detail || detail.length !== src.width * src.height) {
    detail = sharpenDetail(src, sigma, onProgress ? (ratio) => onProgress(ratio * 0.8) : undefined);
    if (key && cache) {
      // One detail plane at a time: a plane is 4 bytes per pixel.
      for (const old of [...cache.keys()]) if (old.startsWith('sharpen:')) cache.delete(old);
      cache.set(key, detail);
    }
  }
  return applySharpenDetail(src, detail, params, onProgress ? (ratio) => onProgress(0.8 + ratio * 0.2) : undefined);
}
