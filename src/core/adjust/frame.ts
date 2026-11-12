import { createRaster } from '../raster.ts';
import type { FrameParams, RasterImage } from '../types.ts';

/** The border width in px that fits the stage: a whole number from 0 to half of the shorter side. */
export function frameWidth(width: number, height: number, params: FrameParams): number {
  const limit = Math.floor(Math.min(width, height) / 2);
  const value = Number.isFinite(params.width) ? Math.round(params.width) : 0;
  return Math.max(0, Math.min(limit, value));
}

export function sameFrame(a: FrameParams, b: FrameParams): boolean {
  return a.width === b.width && a.color.r === b.color.r && a.color.g === b.color.g && a.color.b === b.color.b && a.color.a === b.color.a;
}

/** A stage-size image: an opaque border of the frame width in the frame color along the four edges, a transparent center. */
export function renderFrame(width: number, height: number, params: FrameParams): RasterImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const image = createRaster(w, h);
  const side = frameWidth(w, h, params);
  if (side === 0) return image;
  const { r, g, b } = params.color;
  const pixels = new Uint32Array(image.data.buffer);
  // Little-endian RGBA as one word; the frame is always opaque.
  const word = ((255 << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
  pixels.fill(word, 0, side * w);
  pixels.fill(word, (h - side) * w, h * w);
  for (let y = side; y < h - side; y++) {
    pixels.fill(word, y * w, y * w + side);
    pixels.fill(word, (y + 1) * w - side, (y + 1) * w);
  }
  return image;
}
