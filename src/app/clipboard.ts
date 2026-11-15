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
