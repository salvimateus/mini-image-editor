import type { RasterImage, Rect, Rgba } from './types.ts';

export function createRaster(w: number, h: number, fill?: Rgba): RasterImage {
  const width = Math.max(0, Math.floor(w));
  const height = Math.max(0, Math.floor(h));
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill && (fill.r | fill.g | fill.b | fill.a) !== 0) {
    const pixels = new Uint32Array(data.buffer);
    pixels.fill(packLittle(fill));
  }
  return { width, height, data };
}

/** The RGBA bytes of a color as one little-endian 32-bit word, for Uint32Array fills. */
function packLittle(color: Rgba): number {
  return ((color.a & 0xff) << 24 | (color.b & 0xff) << 16 | (color.g & 0xff) << 8 | (color.r & 0xff)) >>> 0;
}

export function cloneRaster(image: RasterImage): RasterImage {
  return { width: image.width, height: image.height, data: image.data.slice() };
}

export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Copies the pixels of `src` inside `from` to `dst` at (dx, dy). Both rects are clipped to their images. */
export function blitRaster(src: RasterImage, from: Rect, dst: RasterImage, dx: number, dy: number): void {
  let sx = Math.round(from.x);
  let sy = Math.round(from.y);
  let w = Math.round(from.w);
  let h = Math.round(from.h);
  let tx = Math.round(dx);
  let ty = Math.round(dy);
  if (sx < 0) { tx -= sx; w += sx; sx = 0; }
  if (sy < 0) { ty -= sy; h += sy; sy = 0; }
  if (tx < 0) { sx -= tx; w += tx; tx = 0; }
  if (ty < 0) { sy -= ty; h += ty; ty = 0; }
  w = Math.min(w, src.width - sx, dst.width - tx);
  h = Math.min(h, src.height - sy, dst.height - ty);
  if (w <= 0 || h <= 0) return;
  const rowBytes = w * 4;
  for (let row = 0; row < h; row++) {
    const s = ((sy + row) * src.width + sx) * 4;
    const d = ((ty + row) * dst.width + tx) * 4;
    dst.data.set(src.data.subarray(s, s + rowBytes), d);
  }
}

/** The part of the image inside r. r can leave the image: the outside gets `fill` (transparent by default). */
export function cropRaster(image: RasterImage, r: Rect, fill?: Rgba): RasterImage {
  const rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(0, Math.round(r.w)), h: Math.max(0, Math.round(r.h)) };
  const out = createRaster(rect.w, rect.h, fill);
  blitRaster(image, { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, out, 0, 0);
  return out;
}

/** The RGBA bytes inside r, row-major. Pixels outside the image read as transparent. */
export function readRect(image: RasterImage, r: Rect): Uint8ClampedArray {
  return cropRaster(image, r).data;
}

/** Writes the RGBA bytes of r (row-major, r.w * r.h * 4) into the image. The part outside the image is ignored. */
export function writeRect(image: RasterImage, r: Rect, data: Uint8ClampedArray): void {
  const w = Math.round(r.w);
  const h = Math.round(r.h);
  if (data.length < w * h * 4) throw new RangeError(`writeRect needs ${w * h * 4} bytes, got ${data.length}.`);
  blitRaster({ width: w, height: h, data }, { x: 0, y: 0, w, h }, image, r.x, r.y);
}

/** The smallest rect that holds every pixel with alpha > 0, or null for a fully transparent image. */
export function opaqueBounds(image: RasterImage): Rect | null {
  const { width, height, data } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    let o = y * width * 4 + 3;
    let rowMin = -1;
    let rowMax = -1;
    for (let x = 0; x < width; x++, o += 4) {
      if (data[o] !== 0) {
        if (rowMin < 0) rowMin = x;
        rowMax = x;
      }
    }
    if (rowMin < 0) continue;
    if (rowMin < minX) minX = rowMin;
    if (rowMax > maxX) maxX = rowMax;
    if (y < minY) minY = y;
    maxY = y;
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
