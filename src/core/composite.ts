import { createRaster } from './raster.ts';
import type { RasterImage, Rgba } from './types.ts';

/** One layer for a flatten: its image at (x, y) in document px, opacity 0..1. Hidden layers are left out by the caller. */
export interface FlatLayer { image: RasterImage; x: number; y: number; opacity: number }

/**
 * Straight-alpha "over" of the source pixel at `s` (alpha scaled by `opacity`) onto the destination pixel at `d`.
 * A fully opaque source pixel at opacity 1 is copied as it is.
 */
function blendPixel(dst: Uint8ClampedArray, d: number, src: Uint8ClampedArray, s: number, opacity: number): void {
  const sa8 = src[s + 3];
  if (sa8 === 0 || opacity <= 0) return;
  if (sa8 === 255 && opacity >= 1) {
    dst[d] = src[s];
    dst[d + 1] = src[s + 1];
    dst[d + 2] = src[s + 2];
    dst[d + 3] = 255;
    return;
  }
  const sa = (sa8 / 255) * Math.min(1, opacity);
  const da = dst[d + 3] / 255;
  const keep = da * (1 - sa);
  const outA = sa + keep;
  if (outA <= 0) return;
  dst[d] = (src[s] * sa + dst[d] * keep) / outA;
  dst[d + 1] = (src[s + 1] * sa + dst[d + 1] * keep) / outA;
  dst[d + 2] = (src[s + 2] * sa + dst[d + 2] * keep) / outA;
  dst[d + 3] = outA * 255;
}

/** The layers, bottom first, over `background` (transparent by default), at w x h. Layer positions round to whole px. */
export function flatten(w: number, h: number, layers: readonly FlatLayer[], background?: Rgba): RasterImage {
  const out = createRaster(w, h, background);
  const { width, height, data } = out;
  for (const layer of layers) {
    if (layer.opacity <= 0) continue;
    const { image } = layer;
    const lx = Math.round(layer.x);
    const ly = Math.round(layer.y);
    const x0 = Math.max(0, lx);
    const y0 = Math.max(0, ly);
    const x1 = Math.min(width, lx + image.width);
    const y1 = Math.min(height, ly + image.height);
    if (x1 <= x0 || y1 <= y0) continue;
    const src = image.data;
    for (let y = y0; y < y1; y++) {
      let d = (y * width + x0) * 4;
      let s = ((y - ly) * image.width + (x0 - lx)) * 4;
      for (let x = x0; x < x1; x++, d += 4, s += 4) blendPixel(data, d, src, s, layer.opacity);
    }
  }
  return out;
}

/** The composite color of the layers at one document pixel, over transparent. */
export function sampleComposite(layers: readonly FlatLayer[], x: number, y: number): Rgba {
  const px = Math.floor(x);
  const py = Math.floor(y);
  const out = new Uint8ClampedArray(4);
  for (const layer of layers) {
    const ix = px - Math.round(layer.x);
    const iy = py - Math.round(layer.y);
    const { image } = layer;
    if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) continue;
    blendPixel(out, 0, image.data, (iy * image.width + ix) * 4, layer.opacity);
  }
  return { r: out[0], g: out[1], b: out[2], a: out[3] };
}
