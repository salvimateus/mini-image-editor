import { flatten } from '../composite.ts';
import { CoreError, errorMessage } from '../errors.ts';
import { PARAMS } from '../params/index.ts';
import type { RasterImage, Rgba } from '../types.ts';
import type { EncodedFile } from './types.ts';
import { plainJpegSize } from './jpeg-plain-size.ts';

/** MozJPEG color space id of YCbCr. */
const YCBCR = 3;

type Mode = { baseline: true; progressive: false } | { baseline: false; progressive: true };

function opaqueOn(image: RasterImage, background: Rgba): RasterImage {
  const solid = { r: background.r, g: background.g, b: background.b, a: 255 };
  return flatten(image.width, image.height, [{ image, x: 0, y: 0, opacity: 1 }], solid);
}

async function mozjpeg(image: RasterImage, quality: number, mode: Mode): Promise<Uint8Array> {
  const { default: encode } = await import('@jsquash/jpeg/encode');
  try {
    const buffer = await encode({ data: image.data, width: image.width, height: image.height, colorSpace: 'srgb' } as ImageData, {
      ...mode,
      quality,
      optimize_coding: true,
      arithmetic: false,
      smoothing: 0,
      color_space: YCBCR,
      auto_subsample: false,
      chroma_subsample: quality >= PARAMS.export.jpegFullChromaFrom ? 1 : 2,
      separate_chroma_quality: false,
    });
    return new Uint8Array(buffer);
  } catch (error) {
    throw new CoreError('encode-failed', `JPEG: ${errorMessage(error)}`);
  }
}

/**
 * The saved file is the MozJPEG output as it is: progressive scans and optimized coding. The "not optimized" number
 * is the size of a baseline file with the standard Huffman tables, made from a MozJPEG baseline file. The two files
 * do not have identical pixels: the trellis quantization of MozJPEG differs by scan mode.
 */
export async function encodeJpegFile(
  image: RasterImage,
  quality: number,
  background: Rgba,
  optimize: boolean,
  progress: (ratio: number) => void,
): Promise<EncodedFile> {
  const flat = opaqueOn(image, background);
  const q = Math.round(Math.min(100, Math.max(1, quality)));
  const baseline = await mozjpeg(flat, q, { baseline: true, progressive: false });
  let plainSize = baseline.length;
  if (image.width * image.height <= PARAMS.export.jpegPlainSizeMaxPixels) {
    try {
      plainSize = plainJpegSize(baseline);
    } catch (error) {
      // Only a number depends on it: the export goes on with the size of the MozJPEG baseline file.
      console.warn(`JPEG plain size failed: ${errorMessage(error)}`);
    }
  }
  if (!optimize) return { bytes: null, plainSize };
  progress(0.4);
  return { bytes: await mozjpeg(flat, q, { baseline: false, progressive: true }), plainSize };
}
