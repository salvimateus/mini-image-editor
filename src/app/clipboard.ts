import type { RasterImage } from '../core/types.ts';
import { t } from './i18n/index.ts';
import { isSvgFile, isSvgMarkup } from './svg-render.ts';

/**
 * The files of a paste. An SVG wins over a raster copy of it, because it keeps the vector: SVG file items first, then
 * SVG markup in the text (as a new .svg file), else every file item.
 */
export function pastedFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = Array.from(data.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  const svgFiles = files.filter(isSvgFile);
  if (svgFiles.length > 0) return svgFiles;
  for (const type of ['image/svg+xml', 'text/plain']) {
    const text = data.getData(type);
    if (text && isSvgMarkup(text)) return [new File([text], `${t('doc.pastedSvgName')}.svg`, { type: 'image/svg+xml' })];
  }
  return files;
}

/** Pixels that the app copied, with their top-left corner in document px. */
export interface HeldCopy { image: RasterImage; x: number; y: number }

let held: HeldCopy | null = null;

/** The last copy of the app. It is valid while the window keeps the focus: after that, the system clipboard can hold something newer. */
export function heldCopy(): HeldCopy | null {
  return held;
}

export function holdCopy(copy: HeldCopy): void {
  held = copy;
}

export function dropHeldCopy(): void {
  held = null;
}

function pngBlob(image: RasterImage): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('No 2D canvas context.'));
      return;
    }
    ctx.putImageData(new ImageData(image.data.slice() as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The PNG encode failed.'))), 'image/png');
  });
}

/**
 * Puts the image on the system clipboard as a PNG, so that other apps can paste it. Resolves to false when there is no
 * clipboard API or the write fails; it never rejects and shows no error, so the caller decides what a failure means.
 */
export function writeSystemImage(image: RasterImage): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return Promise.resolve(false);
  // The blob goes in as a promise, so the write starts inside the user gesture.
  const blob = pngBlob(image);
  blob.catch(() => {});
  try {
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

/** The first image on the system clipboard as a file (an SVG keeps its vector); empty when there is none or the read fails. */
export async function readSystemImage(): Promise<File[]> {
  if (!navigator.clipboard?.read) return [];
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    return [];
  }
  for (const item of items) {
    const type = item.types.includes('image/svg+xml') ? 'image/svg+xml' : item.types.find((entry) => entry.startsWith('image/'));
    if (!type) continue;
    try {
      const blob = await item.getType(type);
      const ext = type === 'image/svg+xml' ? 'svg' : (type.split('/')[1] ?? 'png');
      const name = type === 'image/svg+xml' ? t('doc.pastedSvgName') : t('doc.pastedImageName');
      return [new File([blob], `${name}.${ext}`, { type })];
    } catch {
      continue;
    }
  }
  return [];
}
