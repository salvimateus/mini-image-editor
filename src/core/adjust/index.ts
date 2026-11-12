import type { Mask } from '../mask.ts';
import { cropRaster, intersectRect } from '../raster.ts';
import type { AdjustOp, Point, RasterImage, Rect } from '../types.ts';
import { blendByCoverage, coverageOf, isEmptyCoverage, type AdjustRunOptions } from './common.ts';
import { applyHueSaturation, isHueSaturationIdentity } from './hue-saturation.ts';
import { applyLevels, isLevelsIdentity } from './levels.ts';
import { applySharpen, isSharpenIdentity, sharpenReach, sharpenSigma } from './sharpen.ts';

export type { AdjustRunOptions } from './common.ts';
export { autoLevels, histogram } from './histogram.ts';
export { HUE_SATURATION_IDENTITY, hueSaturationMap, isHueSaturationIdentity } from './hue-saturation.ts';
export { cleanLevels, gammaFromHandle, gammaHandle, isLevelsIdentity, LEVELS_IDENTITY, levelsTable } from './levels.ts';
export { cleanSharpen, isSharpenIdentity } from './sharpen.ts';
export { cleanVignette, renderVignette, sameVignette, VIGNETTE_RANGES } from './vignette.ts';

/** True when the op leaves every pixel as it is. */
export function isIdentityOp(op: AdjustOp): boolean {
  switch (op.kind) {
    case 'hue-saturation':
      return isHueSaturationIdentity(op.params);
    case 'levels':
      return isLevelsIdentity(op.params);
    case 'sharpen':
      return isSharpenIdentity(op.params);
  }
}

/**
 * The single entry point of the filters. The pixel (0, 0) of `src` sits at `offset` on the document `mask` (null =
 * everything); the mask blends the result by coverage. Straight alpha in and out; alpha never changes.
 */
export function applyAdjust(src: RasterImage, op: AdjustOp, mask: Mask | null, offset: Point, options: AdjustRunOptions = {}): RasterImage {
  return applyAdjustCovered(src, op, coverageOf(mask, src.width, src.height, offset), options);
}

/** applyAdjust with the coverage plane already at the size of `src` (a proxy keeps its own plane). */
export function applyAdjustCovered(src: RasterImage, op: AdjustOp, cover: Uint8Array | null, options: AdjustRunOptions = {}): RasterImage {
  const { onProgress } = options;
  if (isIdentityOp(op) || isEmptyCoverage(cover)) {
    onProgress?.(1);
    return { width: src.width, height: src.height, data: src.data.slice() };
  }
  let out: RasterImage;
  switch (op.kind) {
    case 'hue-saturation':
      out = applyHueSaturation(src, op.params, onProgress);
      break;
    case 'levels':
      out = applyLevels(src, op.params, onProgress);
      break;
    case 'sharpen':
      out = applySharpen(src, op.params, options);
      break;
  }
  blendByCoverage(src, out, cover);
  onProgress?.(1);
  return out;
}

/**
 * The op on one part of the source at full resolution. `region` is in source px and is clipped to the source; a
 * sharpen reads a margin around it, so the edges of the region match the full result. Null when nothing is left.
 */
export function applyAdjustRegion(
  src: RasterImage,
  op: AdjustOp,
  mask: Mask | null,
  offset: Point,
  region: Rect,
  options: AdjustRunOptions = {},
): { image: RasterImage; rect: Rect } | null {
  const rect = intersectRect(
    { x: Math.floor(region.x), y: Math.floor(region.y), w: Math.ceil(region.w), h: Math.ceil(region.h) },
    { x: 0, y: 0, w: src.width, h: src.height },
  );
  if (!rect) return null;
  const margin = op.kind === 'sharpen' ? sharpenReach(sharpenSigma(op.params, options.pixelScale)) : 0;
  const read = intersectRect({ x: rect.x - margin, y: rect.y - margin, w: rect.w + margin * 2, h: rect.h + margin * 2 }, { x: 0, y: 0, w: src.width, h: src.height }) ?? rect;
  const part = cropRaster(src, read);
  const cacheKey = options.cacheKey === undefined ? undefined : `${options.cacheKey}:${read.x},${read.y},${read.w},${read.h}`;
  const done = applyAdjust(part, op, mask, { x: offset.x + read.x, y: offset.y + read.y }, { ...options, cacheKey });
  const image = read === rect ? done : cropRaster(done, { x: rect.x - read.x, y: rect.y - read.y, w: rect.w, h: rect.h });
  return { image, rect };
}
