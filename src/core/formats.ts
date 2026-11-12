import type { ExportFormat } from './types.ts';

export interface FormatInfo { ext: string; mime: string; label: string; lossless: boolean; alpha: boolean; maxSide: number }

export const FORMAT_INFO: Record<ExportFormat, FormatInfo> = {
  png: { ext: 'png', mime: 'image/png', label: 'PNG', lossless: true, alpha: true, maxSide: 16384 },
  webp: { ext: 'webp', mime: 'image/webp', label: 'WebP', lossless: true, alpha: true, maxSide: 16383 },
  jpeg: { ext: 'jpg', mime: 'image/jpeg', label: 'JPEG', lossless: false, alpha: false, maxSide: 16384 },
  ico: { ext: 'ico', mime: 'image/x-icon', label: 'ICO', lossless: true, alpha: true, maxSide: 256 },
};

export const EXPORT_FORMATS: readonly ExportFormat[] = ['png', 'webp', 'jpeg', 'ico'];
