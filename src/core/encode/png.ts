import { errorMessage } from '../errors.ts';
import { PARAMS } from '../params/index.ts';
import { encodePng } from '../png.ts';
import type { RasterImage } from '../types.ts';
import type { EncodedFile } from './types.ts';

type Optimise = (data: Uint8Array, level: number, interlace: boolean, optimizeAlpha: boolean) => Uint8Array;

let ready: Promise<Optimise> | null = null;

/** The single-thread build: the threaded one needs cross-origin isolation, which the app does not have. */
function loadOxipng(): Promise<Optimise> {
  ready ??= import('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js').then(async (codec) => {
    await codec.default();
    return codec.optimise;
  });
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

/** oxipng on a PNG file, alpha optimization on (the RGB of fully transparent pixels can change). Null when it fails. */
export async function optimizePng(plain: Uint8Array): Promise<Uint8Array | null> {
  try {
    const optimise = await loadOxipng();
    return optimise(plain, PARAMS.export.oxipngLevel, false, true);
  } catch (error) {
    console.warn(`oxipng failed: ${errorMessage(error)}`);
    return null;
  }
}

/** The plain size and, when `optimize` is on, the smaller of the plain and the oxipng file. */
export async function encodePngFile(image: RasterImage, optimize: boolean): Promise<EncodedFile> {
  const plain = encodePng(image);
  if (!optimize) return { bytes: null, plainSize: plain.length };
  const optimized = await optimizePng(plain);
  return { bytes: optimized && optimized.length < plain.length ? optimized : plain, plainSize: plain.length };
}
