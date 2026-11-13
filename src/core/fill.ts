import { flatten } from './composite.ts';
import { maskFromData, type Mask } from './mask.ts';
import { PAINT_PARAMS } from './params/paint.ts';
import type { Patch, Point, RasterImage, Rect, Rgba } from './types.ts';

export interface FloodOptions {
  /** 0..255 on the RGBA distance (the largest channel difference). */
  tolerance: number;
  /** false: every pixel of the image that matches, not only the region connected to the seed. */
  contiguous: boolean;
  /** Partial coverage on the pixels just outside the region, so a filled shape keeps a smooth edge. */
  antiAlias?: boolean;
}

/**
 * The distance of each pixel to the seed color: the largest RGBA channel difference. Two fully transparent pixels
 * are equal whatever their RGB, because a straight-alpha image can keep any RGB under alpha 0.
 */
function distanceTo(data: Uint8ClampedArray, seed: number): (o: number) => number {
  const r = data[seed];
  const g = data[seed + 1];
  const b = data[seed + 2];
  const a = data[seed + 3];
  return (o) => {
    const pa = data[o + 3];
    if (pa === 0 && a === 0) return 0;
    const dr = Math.abs(data[o] - r);
    const dg = Math.abs(data[o + 1] - g);
    const db = Math.abs(data[o + 2] - b);
    const da = Math.abs(pa - a);
    return Math.max(dr, dg, db, da);
  };
}

/** Scanline flood from (sx, sy): sets 255 in `out` for each connected pixel that `inside` accepts. */
function scanlineFill(width: number, height: number, sx: number, sy: number, inside: (i: number) => boolean, out: Uint8Array): void {
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    const row = y * width;
    if (out[row + x] || !inside(row + x)) continue;
    let left = x;
    while (left > 0 && !out[row + left - 1] && inside(row + left - 1)) left--;
    let right = x;
    while (right < width - 1 && !out[row + right + 1] && inside(row + right + 1)) right++;
    out.fill(255, row + left, row + right + 1);
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= height) continue;
      const nrow = ny * width;
      let open = false;
      for (let nx = left; nx <= right; nx++) {
        const free = !out[nrow + nx] && inside(nrow + nx);
        if (free && !open) stack.push(nx, ny);
        open = free;
      }
    }
  }
}

/** Partial coverage on the pixels next to the region (4-neighbours): it falls from 255 to 0 over the edge ramp. */
function softenEdge(width: number, height: number, out: Uint8Array, distance: (o: number) => number, tolerance: number): void {
  const ramp = PAINT_PARAMS.fillEdgeRamp;
  const edge: number[] = [];
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      if (out[i]) continue;
      const touches = (x > 0 && out[i - 1] === 255) || (x < width - 1 && out[i + 1] === 255) || (y > 0 && out[i - width] === 255) || (y < height - 1 && out[i + width] === 255);
      if (!touches) continue;
      const over = distance(i * 4) - tolerance;
      const value = Math.round(255 * (1 - over / ramp));
      if (value > 0) edge.push(i, Math.min(254, value));
    }
  }
  for (let n = 0; n < edge.length; n += 2) out[edge[n]] = edge[n + 1];
}

/**
 * The region of the pixels that match the color at (x, y), in image px. The mask has the image size. A seed outside
 * the image gives an empty mask.
 */
export function floodMask(image: RasterImage, x: number, y: number, options: FloodOptions): Mask {
  const { width, height, data } = image;
  const out = new Uint8Array(width * height);
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return maskFromData(width, height, out);
  const tolerance = Math.max(0, Math.min(255, options.tolerance));
  const distance = distanceTo(data, (sy * width + sx) * 4);
  const inside = (i: number) => distance(i * 4) <= tolerance;
  if (options.contiguous) {
    scanlineFill(width, height, sx, sy, inside, out);
  } else {
    for (let i = 0; i < out.length; i++) if (inside(i)) out[i] = 255;
  }
  if (options.antiAlias) softenEdge(width, height, out, distance, tolerance);
  return maskFromData(width, height, out);
}

/** The coverage 0..255 of a document-size mask at a document pixel; null = everything, outside = 0. */
function maskAt(mask: Mask | null, x: number, y: number): number {
  if (!mask) return 255;
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  return mask.data[y * mask.width + x];
}

/** The part of the layer image (layer px) that a mask in document px can reach, or null. */
function reach(image: RasterImage, offset: Point, ...masks: (Mask | null)[]): Rect | null {
  let x0 = 0;
  let y0 = 0;
  let x1 = image.width;
  let y1 = image.height;
  for (const mask of masks) {
    if (!mask) continue;
    const b = mask.bounds;
    if (!b) return null;
    x0 = Math.max(x0, b.x - offset.x);
    y0 = Math.max(y0, b.y - offset.y);
    x1 = Math.min(x1, b.x + b.w - offset.x);
    y1 = Math.min(y1, b.y + b.h - offset.y);
  }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * The patch that paints `color` over the layer image where `mask` and `selection` cover it (both in document px; null
 * = everything). `offset` = the layer position in document px; opacity 0..1. The image does not change: commit the
 * patch. Null when no pixel changes.
 */
export function fillMask(image: RasterImage, mask: Mask | null, color: Rgba, opacity: number, selection: Mask | null, offset: Point): Patch | null {
  const ox = Math.round(offset.x);
  const oy = Math.round(offset.y);
  const area = reach(image, { x: ox, y: oy }, mask, selection);
  const strength = (Math.max(0, Math.min(255, color.a)) / 255) * Math.max(0, Math.min(1, opacity));
  if (!area || strength <= 0) return null;
  const { width, data } = image;
  const before = new Uint8ClampedArray(area.w * area.h * 4);
  const after = new Uint8ClampedArray(area.w * area.h * 4);
  let minX = area.w;
  let minY = area.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < area.h; y++) {
    const ly = area.y + y;
    for (let x = 0; x < area.w; x++) {
      const lx = area.x + x;
      const s = (ly * width + lx) * 4;
      const d = (y * area.w + x) * 4;
      before[d] = after[d] = data[s];
      before[d + 1] = after[d + 1] = data[s + 1];
      before[d + 2] = after[d + 2] = data[s + 2];
      before[d + 3] = after[d + 3] = data[s + 3];
      const cover = (maskAt(mask, lx + ox, ly + oy) * maskAt(selection, lx + ox, ly + oy)) / 65025;
      if (cover <= 0) continue;
      if (!blendOver(after, d, color, strength * cover)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  if (maxX < 0) return null;
  const rect = { x: area.x + minX, y: area.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  if (rect.w === area.w && rect.h === area.h) return { rect, before, after };
  return { rect, before: cropBytes(before, area.w, minX, minY, rect.w, rect.h), after: cropBytes(after, area.w, minX, minY, rect.w, rect.h) };
}

/** Straight-alpha "over" of `color` at `alpha` (0..1) onto the pixel at `d`, in place. True when the pixel changes. */
export function blendOver(px: Uint8ClampedArray, d: number, color: Rgba, alpha: number): boolean {
  if (alpha <= 0) return false;
  const r0 = px[d];
  const g0 = px[d + 1];
  const b0 = px[d + 2];
  const a0 = px[d + 3];
  if (alpha >= 1) {
    px[d] = color.r;
    px[d + 1] = color.g;
    px[d + 2] = color.b;
    px[d + 3] = 255;
  } else {
    const da = a0 / 255;
    const keep = da * (1 - alpha);
    const outA = alpha + keep;
    px[d] = (color.r * alpha + r0 * keep) / outA;
    px[d + 1] = (color.g * alpha + g0 * keep) / outA;
    px[d + 2] = (color.b * alpha + b0 * keep) / outA;
    px[d + 3] = outA * 255;
  }
  return px[d] !== r0 || px[d + 1] !== g0 || px[d + 2] !== b0 || px[d + 3] !== a0;
}

function cropBytes(src: Uint8ClampedArray, srcW: number, x: number, y: number, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const s = ((y + row) * srcW + x) * 4;
    out.set(src.subarray(s, s + w * 4), row * w * 4);
  }
  return out;
}

/** The layer fields that `paintSource` reads; a layer with a `generator` (the vignette) is an effect, not content. */
export interface SourceLayer { image: RasterImage; x: number; y: number; opacity: number; visible: boolean; generator?: unknown }

/**
 * The visible layers at stage size without the generated layers: the pixels that the clone stamp copies. Otherwise a
 * vignette would darken a cloned area two times.
 */
export function paintSource(width: number, height: number, layers: readonly SourceLayer[]): RasterImage {
  const flat = layers.filter((layer) => layer.visible && layer.opacity > 0 && !layer.generator).map((layer) => ({ image: layer.image, x: layer.x, y: layer.y, opacity: layer.opacity }));
  return flatten(width, height, flat);
}
