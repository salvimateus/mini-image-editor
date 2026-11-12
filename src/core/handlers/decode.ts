import { CoreError, errorMessage } from '../errors.ts';
import { PARAMS } from '../params/index.ts';
import { decodePng, isPng, pngSize } from '../png.ts';
import type { Handler } from '../protocol.ts';
import type { RasterImage } from '../types.ts';

type Size = { width: number; height: number };

function tag(bytes: Uint8Array, offset: number, length = 4): string {
  let text = '';
  for (let i = 0; i < length && offset + i < bytes.length; i++) text += String.fromCharCode(bytes[offset + i]);
  return text;
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && tag(bytes, 0) === 'RIFF' && tag(bytes, 8) === 'WEBP';
}

/** Canvas size from the first chunk (VP8X, VP8 or VP8L), or null when the header is short or unknown. */
function webpSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 30) return null;
  const chunk = tag(bytes, 12);
  if (chunk === 'VP8X') {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  if (chunk === 'VP8 ') {
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    return { width, height };
  }
  if (chunk === 'VP8L') {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  return null;
}

/** The format of the magic bytes, as a short name, or null when no known image format matches. */
function sniff(bytes: Uint8Array): string | null {
  if (isPng(bytes)) return 'png';
  if (isWebp(bytes)) return 'webp';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (tag(bytes, 0, 6) === 'GIF87a' || tag(bytes, 0, 6) === 'GIF89a') return 'gif';
  if (tag(bytes, 0, 2) === 'BM') return 'bmp';
  if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return 'ico';
  if (bytes.length >= 12 && tag(bytes, 4) === 'ftyp') {
    const brand = tag(bytes, 8);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  if ((tag(bytes, 0) === 'II*\0') || (tag(bytes, 0) === 'MM\0*')) return 'tiff';
  return null;
}

const MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  tiff: 'image/tiff',
};

/** Throws too-large above the limits of PARAMS.limits. */
export function checkLimits(size: Size): void {
  const { maxSide, maxPixels } = PARAMS.limits;
  if (size.width > maxSide || size.height > maxSide) {
    throw new CoreError('too-large', `The image is ${size.width} x ${size.height}; each side must be at most ${maxSide} pixels.`);
  }
  if (size.width * size.height > maxPixels) {
    throw new CoreError('too-large', `The image has ${size.width * size.height} pixels; the limit is ${maxPixels}.`);
  }
}

async function decodeWebp(bytes: Uint8Array): Promise<RasterImage> {
  const size = webpSize(bytes);
  if (size) checkLimits(size);
  const { default: decode } = await import('@jsquash/webp/decode');
  let pixels: ImageData;
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    pixels = await decode(buffer);
  } catch (error) {
    throw new CoreError('decode-failed', `The WebP file is damaged: ${errorMessage(error)}`);
  }
  return { width: pixels.width, height: pixels.height, data: pixels.data };
}

/** EXIF orientation applied, default color space conversion. Partly transparent pixels can change in the canvas. */
async function decodeWithBrowser(bytes: Uint8Array, format: string | null): Promise<RasterImage> {
  let bitmap: ImageBitmap;
  try {
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], format && MIME[format] ? { type: MIME[format] } : {});
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha: 'none' });
  } catch (error) {
    if (!format) throw new CoreError('not-an-image', 'The file is not an image.');
    throw new CoreError('decode-failed', `The image is damaged: ${errorMessage(error)}`);
  }
  try {
    const { width, height } = bitmap;
    if (width <= 0 || height <= 0) throw new CoreError('decode-failed', 'The image has no pixels.');
    checkLimits(bitmap);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new CoreError('internal', 'No 2D canvas in the worker.');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, width, height);
    return { width, height, data: pixels.data };
  } finally {
    bitmap.close();
  }
}

export const decode: Handler<'decode'> = async (request, context) => {
  if (!(request.bytes instanceof ArrayBuffer) || request.bytes.byteLength === 0) throw new CoreError('not-an-image', 'The file is empty.');
  const bytes = new Uint8Array(request.bytes);
  const format = sniff(bytes);
  const name = typeof request.name === 'string' ? request.name.toLowerCase() : '';
  if (format === 'heic' || (!format && name.endsWith('.svg'))) {
    throw new CoreError('unsupported-format', `The format of ${request.name} is not supported.`);
  }
  context.progress(0);
  let image: RasterImage;
  if (format === 'png') {
    const size = pngSize(bytes);
    if (size) checkLimits(size);
    image = decodePng(bytes);
  } else if (format === 'webp') {
    image = await decodeWebp(bytes);
  } else {
    image = await decodeWithBrowser(bytes, format);
  }
  checkLimits(image);
  context.progress(1);
  return { reply: { type: 'decode', image, format: format ?? 'unknown' }, transfer: [image.data.buffer] };
};
