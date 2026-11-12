import { CoreError } from './errors.ts';
import { PARAMS } from './params/index.ts';
import { cloneRaster } from './raster.ts';
import type { RasterImage, ResampleMethod } from './types.ts';

export interface ResizeOptions {
  /** Called with a ratio 0..1 while the work runs. */
  onProgress?(ratio: number): void;
}

interface Kernel { radius: number; weight(x: number): number }

/** Pre-computed taps of one axis: output i reads `counts[i]` source px from `starts[i]`, weights at `i * stride`. */
interface AxisWeights { starts: Int32Array; counts: Int32Array; weights: Float32Array; stride: number }

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function lanczosKernel(): Kernel {
  const lobes = PARAMS.resample.lanczosLobes;
  return { radius: lobes, weight: (x) => (Math.abs(x) < lobes ? sinc(x) * sinc(x / lobes) : 0) };
}

function mitchellKernel(): Kernel {
  const { mitchellB: b, mitchellC: c, mitchellRadius } = PARAMS.resample;
  return {
    radius: mitchellRadius,
    weight: (value) => {
      const x = Math.abs(value);
      if (x < 1) return ((12 - 9 * b - 6 * c) * x * x * x + (-18 + 12 * b + 6 * c) * x * x + (6 - 2 * b)) / 6;
      if (x < 2) return ((-b - 6 * c) * x * x * x + (6 * b + 30 * c) * x * x + (-12 * b - 48 * c) * x + (8 * b + 24 * c)) / 6;
      return 0;
    },
  };
}

/** 'auto' picks per axis: Lanczos when the axis shrinks, Mitchell when it grows. */
function kernelFor(method: Exclude<ResampleMethod, 'nearest'>, srcN: number, dstN: number): Kernel {
  if (method === 'sharp') return lanczosKernel();
  if (method === 'smooth') return mitchellKernel();
  return dstN < srcN ? lanczosKernel() : mitchellKernel();
}

function identityWeights(n: number): AxisWeights {
  const starts = new Int32Array(n);
  for (let i = 0; i < n; i++) starts[i] = i;
  return { starts, counts: new Int32Array(n).fill(1), weights: new Float32Array(n).fill(1), stride: 1 };
}

/** The kernel widens by the shrink factor, so that each output px averages all source px under it (no aliasing). */
function axisWeights(srcN: number, dstN: number, kernel: Kernel): AxisWeights {
  if (srcN === dstN) return identityWeights(dstN);
  const scale = srcN / dstN;
  const filterScale = Math.max(1, scale);
  const support = kernel.radius * filterScale;
  const stride = Math.ceil(support * 2) + 2;
  const starts = new Int32Array(dstN);
  const counts = new Int32Array(dstN);
  const weights = new Float32Array(dstN * stride);
  const taps = new Float64Array(stride);
  for (let i = 0; i < dstN; i++) {
    const center = (i + 0.5) * scale;
    const first = Math.max(0, Math.ceil(center - support - 0.5));
    const last = Math.min(srcN - 1, Math.floor(center + support - 0.5));
    let count = 0;
    let sum = 0;
    for (let j = first; j <= last && count < stride; j++, count++) {
      const w = kernel.weight((j + 0.5 - center) / filterScale);
      taps[count] = w;
      sum += w;
    }
    const base = i * stride;
    if (count === 0 || Math.abs(sum) < 1e-12) {
      starts[i] = Math.min(srcN - 1, Math.max(0, Math.floor(center)));
      counts[i] = 1;
      weights[base] = 1;
      continue;
    }
    starts[i] = first;
    counts[i] = count;
    for (let k = 0; k < count; k++) weights[base + k] = taps[k] / sum;
  }
  return { starts, counts, weights, stride };
}

function resizeNearest(src: RasterImage, width: number, height: number, onProgress: ((ratio: number) => void) | undefined): RasterImage {
  const out = new Uint8ClampedArray(width * height * 4);
  const xMap = new Int32Array(width);
  const sx = src.width / width;
  for (let x = 0; x < width; x++) xMap[x] = Math.min(src.width - 1, Math.floor((x + 0.5) * sx)) * 4;
  const sy = src.height / height;
  const every = Math.max(1, Math.ceil(height / PARAMS.resample.progressSteps));
  const data = src.data;
  for (let y = 0; y < height; y++) {
    const row = Math.min(src.height - 1, Math.floor((y + 0.5) * sy)) * src.width * 4;
    let d = y * width * 4;
    for (let x = 0; x < width; x++, d += 4) {
      const s = row + xMap[x];
      const a = data[s + 3];
      if (a === 0) continue;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = a;
    }
    if (onProgress && (y + 1) % every === 0) onProgress((y + 1) / height);
  }
  return { width, height, data: out };
}

/** One source row through the horizontal taps, into premultiplied floats (color in alpha x color units). */
function filterRow(src: RasterImage, sy: number, axis: AxisWeights, out: Float32Array): void {
  const { starts, counts, weights, stride } = axis;
  const data = src.data;
  const rowBase = sy * src.width;
  const width = starts.length;
  for (let x = 0, o = 0; x < width; x++, o += 4) {
    const base = x * stride;
    const count = counts[x];
    let p = (rowBase + starts[x]) * 4;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let k = 0; k < count; k++, p += 4) {
      const wa = weights[base + k] * data[p + 3];
      r += wa * data[p];
      g += wa * data[p + 1];
      b += wa * data[p + 2];
      a += wa;
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }
}

function resizeFiltered(src: RasterImage, width: number, height: number, method: Exclude<ResampleMethod, 'nearest'>, onProgress: ((ratio: number) => void) | undefined): RasterImage {
  const xAxis = axisWeights(src.width, width, kernelFor(method, src.width, width));
  const yAxis = axisWeights(src.height, height, kernelFor(method, src.height, height));
  const rowLength = width * 4;

  // Filtered source rows live in a ring: the tap windows move down only, so each source row is filtered once.
  const ringSize = yAxis.stride;
  const ring: Float32Array[] = [];
  for (let i = 0; i < ringSize; i++) ring.push(new Float32Array(rowLength));
  const ringRow = new Int32Array(ringSize).fill(-1);
  const rowAt = (sy: number): Float32Array => {
    const slot = sy % ringSize;
    const row = ring[slot];
    if (ringRow[slot] !== sy) {
      filterRow(src, sy, xAxis, row);
      ringRow[slot] = sy;
    }
    return row;
  };

  const out = new Uint8ClampedArray(width * height * 4);
  const acc = new Float64Array(rowLength);
  const every = Math.max(1, Math.ceil(height / PARAMS.resample.progressSteps));
  for (let y = 0; y < height; y++) {
    const base = y * yAxis.stride;
    const start = yAxis.starts[y];
    const count = yAxis.counts[y];
    acc.fill(0);
    for (let k = 0; k < count; k++) {
      const w = yAxis.weights[base + k];
      const row = rowAt(start + k);
      for (let i = 0; i < rowLength; i++) acc[i] += w * row[i];
    }
    let d = y * rowLength;
    for (let i = 0; i < rowLength; i += 4, d += 4) {
      const a = acc[i + 3];
      // Below half a level the byte rounds to 0: a fully transparent pixel keeps RGB 0.
      if (a < 0.5) continue;
      out[d] = acc[i] / a;
      out[d + 1] = acc[i + 1] / a;
      out[d + 2] = acc[i + 2] / a;
      out[d + 3] = a;
    }
    if (onProgress && (y + 1) % every === 0) onProgress((y + 1) / height);
  }
  return { width, height, data: out };
}

function isSize(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

/**
 * A copy of `src` at width x height. Filters work on premultiplied alpha, so transparent px never darken the edges.
 * 'sharp' = Lanczos3, 'smooth' = Mitchell-Netravali, 'nearest' = nearest neighbor, 'auto' = Lanczos3 to shrink, Mitchell to grow.
 */
export function resizeRaster(src: RasterImage, width: number, height: number, method: ResampleMethod, options: ResizeOptions = {}): RasterImage {
  if (!isSize(width) || !isSize(height)) throw new CoreError('internal', `The target size ${width} x ${height} must be whole numbers of 1 or more.`);
  if (!src || !isSize(src.width) || !isSize(src.height) || !(src.data instanceof Uint8ClampedArray) || src.data.length !== src.width * src.height * 4) {
    throw new CoreError('internal', 'The source image is not a valid RGBA8 raster.');
  }
  if (method !== 'auto' && method !== 'smooth' && method !== 'sharp' && method !== 'nearest') {
    throw new CoreError('internal', `Unknown resample method ${String(method)}.`);
  }
  const { onProgress } = options;
  if (width === src.width && height === src.height) {
    onProgress?.(1);
    return cloneRaster(src);
  }
  const result = method === 'nearest'
    ? resizeNearest(src, width, height, onProgress)
    : resizeFiltered(src, width, height, method, onProgress);
  onProgress?.(1);
  return result;
}
