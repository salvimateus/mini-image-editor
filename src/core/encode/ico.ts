import { CoreError } from '../errors.ts';
import { PARAMS } from '../params/index.ts';
import { encodePng } from '../png.ts';
import { createRaster, writeRect } from '../raster.ts';
import { resizeRaster } from '../resample.ts';
import type { RasterImage } from '../types.ts';
import type { EncodedFile } from './types.ts';
import { optimizePng } from './png.ts';

const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

/**
 * The entry sides for an image whose longest side is `longest`: the requested sides that the format permits (the
 * default list when none is valid), ascending and unique, without the sides larger than the image, so no entry is
 * enlarged. When none is left, one entry: the largest permitted side not larger than the image, or the image side
 * itself when the image is smaller than the smallest permitted side.
 */
export function icoSizes(requested: readonly number[], longest: number): number[] {
  const { icoMinSide, icoMaxSide } = PARAMS.export;
  const permitted = (size: number) => Number.isInteger(size) && size >= icoMinSide && size <= icoMaxSide;
  const valid = [...new Set(requested.filter(permitted))].sort((a, b) => a - b);
  const list = valid.length > 0 ? valid : [...PARAMS.export.icoSizes];
  const fitting = list.filter((size) => size <= longest);
  if (fitting.length > 0) return fitting;
  const side = Math.max(1, Math.floor(longest));
  return [side >= icoMinSide ? Math.min(side, icoMaxSide) : side];
}

/** The image scaled to fit inside a transparent square of `size` px, centered. */
export function icoEntryImage(image: RasterImage, size: number): RasterImage {
  const scale = size / Math.max(image.width, image.height);
  const width = Math.max(1, Math.min(size, Math.round(image.width * scale)));
  const height = Math.max(1, Math.min(size, Math.round(image.height * scale)));
  const fitted = width === image.width && height === image.height ? image : resizeRaster(image, width, height, 'auto');
  if (width === size && height === size) return fitted;
  const square = createRaster(size, size);
  writeRect(square, { x: Math.floor((size - width) / 2), y: Math.floor((size - height) / 2), w: width, h: height }, fitted.data);
  return square;
}

/** An ICO file with one PNG entry for each size. A side of 256 is written as 0, as the format asks. */
export function buildIco(entries: readonly { size: number; png: Uint8Array }[]): Uint8Array {
  if (entries.length === 0 || entries.length > 0xffff) throw new CoreError('encode-failed', 'An ICO file needs 1 to 65535 entries.');
  const total = HEADER_BYTES + ENTRY_BYTES * entries.length + entries.reduce((sum, entry) => sum + entry.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, entries.length, true);
  let offset = HEADER_BYTES + ENTRY_BYTES * entries.length;
  entries.forEach((entry, index) => {
    const at = HEADER_BYTES + ENTRY_BYTES * index;
    const side = entry.size >= 256 ? 0 : entry.size;
    view.setUint8(at, side);
    view.setUint8(at + 1, side);
    view.setUint8(at + 2, 0);
    view.setUint8(at + 3, 0);
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, entry.png.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(entry.png, offset);
    offset += entry.png.length;
  });
  return out;
}

/** True for an 8-bit RGBA PNG (IHDR bit depth 8, color type 6): the entry type that every Windows icon reader accepts. */
function isRgba8Png(png: Uint8Array): boolean {
  return png.length > 25 && png[24] === 8 && png[25] === 6;
}

/**
 * The plain file holds plain PNG entries. The optimized file holds the oxipng entry when it is smaller and still
 * 8-bit RGBA, so the 32-bit entry of the directory stays true.
 */
export async function encodeIcoFile(
  image: RasterImage,
  requested: readonly number[],
  optimize: boolean,
  progress: (ratio: number) => void,
): Promise<EncodedFile> {
  const sizes = icoSizes(requested, Math.max(image.width, image.height));
  const plain: { size: number; png: Uint8Array }[] = [];
  const best: { size: number; png: Uint8Array }[] = [];
  for (const [index, size] of sizes.entries()) {
    const png = encodePng(icoEntryImage(image, size));
    plain.push({ size, png });
    const optimized = optimize ? await optimizePng(png) : null;
    best.push({ size, png: optimized && optimized.length < png.length && isRgba8Png(optimized) ? optimized : png });
    progress((index + 1) / sizes.length);
  }
  const plainSize = buildIco(plain).length;
  return { bytes: optimize ? buildIco(best) : null, plainSize };
}
