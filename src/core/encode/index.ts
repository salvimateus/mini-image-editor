import type { ExportOptions, RasterImage } from '../types.ts';
import { encodeIcoFile } from './ico.ts';
import { encodeJpegFile } from './jpeg.ts';
import { checkExportSize } from './limits.ts';
import { encodePngFile } from './png.ts';
import type { EncodedFile } from './types.ts';
import { encodeWebpFile } from './webp.ts';

export { checkExportSize, fitsFormat } from './limits.ts';
export type { EncodedFile } from './types.ts';

export interface EncodeRun {
  /** Off: only the plain size is made, and `bytes` is null. */
  optimize: boolean;
  progress(ratio: number): void;
}

/** The one entry point of the encoders. Runs only in a worker. Throws `too-large` above the side limit of the format. */
export async function encodeImage(image: RasterImage, options: ExportOptions, run: EncodeRun): Promise<EncodedFile> {
  checkExportSize(options.format, image.width, image.height);
  run.progress(0);
  let file: EncodedFile;
  switch (options.format) {
    case 'png':
      file = await encodePngFile(image, run.optimize);
      break;
    case 'webp':
      file = await encodeWebpFile(image, run.optimize, run.progress);
      break;
    case 'jpeg':
      file = await encodeJpegFile(image, options.jpegQuality, options.background, run.optimize, run.progress);
      break;
    case 'ico':
      file = await encodeIcoFile(image, options.icoSizes, run.optimize, run.progress);
      break;
  }
  run.progress(1);
  return file;
}
