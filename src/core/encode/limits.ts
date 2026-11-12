import { CoreError } from '../errors.ts';
import { FORMAT_INFO } from '../formats.ts';
import type { ExportFormat } from '../types.ts';

/**
 * True when an image of this size can be saved in the format. Pure: the dialog and the workers share it. ICO accepts
 * any size: its side limit applies to each entry, which is a reduced copy of the image.
 */
export function fitsFormat(format: ExportFormat, width: number, height: number): boolean {
  if (format === 'ico') return width >= 1 && height >= 1;
  const { maxSide } = FORMAT_INFO[format];
  return width >= 1 && height >= 1 && width <= maxSide && height <= maxSide;
}

/** Throws `too-large` when the format cannot hold an image of this size. */
export function checkExportSize(format: ExportFormat, width: number, height: number): void {
  if (fitsFormat(format, width, height)) return;
  const info = FORMAT_INFO[format];
  throw new CoreError('too-large', `The image is ${width} x ${height}; ${info.label} permits at most ${info.maxSide} pixels a side.`);
}
