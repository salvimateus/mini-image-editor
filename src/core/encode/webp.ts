import { CoreError, errorMessage } from '../errors.ts';
import { PARAMS } from '../params/index.ts';
import type { RasterImage } from '../types.ts';
import type { EncodedFile } from './types.ts';

function imageData(image: RasterImage): ImageData {
  // The encoder reads only these three fields.
  return { data: image.data, width: image.width, height: image.height, colorSpace: 'srgb' } as ImageData;
}

async function encodeLossless(image: RasterImage, effort: { method: number; quality: number }): Promise<Uint8Array> {
  const { default: encode } = await import('@jsquash/webp/encode');
  try {
    // exact 0: the RGB of fully transparent pixels can change, which lets the encoder compress them.
    const buffer = await encode(imageData(image), { lossless: 1, exact: 0, method: effort.method, quality: effort.quality });
    return new Uint8Array(buffer);
  } catch (error) {
    throw new CoreError('encode-failed', `WebP: ${errorMessage(error)}`);
  }
}

/** Lossless WebP: the plain file with the fastest effort, the optimized file with the strongest effort that stays quick. */
export async function encodeWebpFile(
  image: RasterImage,
  optimize: boolean,
  progress: (ratio: number) => void,
): Promise<EncodedFile> {
  const plain = await encodeLossless(image, PARAMS.export.webpPlain);
  if (!optimize) return { bytes: null, plainSize: plain.length };
  progress(0.3);
  const { webpOptimized, webpOptimizedLarge, webpStrongestMaxPixels } = PARAMS.export;
  const optimized = await encodeLossless(image, image.width * image.height <= webpStrongestMaxPixels ? webpOptimized : webpOptimizedLarge);
  return { bytes: optimized.length < plain.length ? optimized : plain, plainSize: plain.length };
}
