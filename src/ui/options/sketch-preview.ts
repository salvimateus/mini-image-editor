import { PARAMS } from '../../core/params/index.ts';
import type { SketchPresetId } from '../../core/params/paint.ts';
import { createRaster } from '../../core/raster.ts';
import { Stroke, type StrokePoint } from '../../core/stroke.ts';
import { TUNING } from '../../app/tuning/index.ts';

/** Size of a preview in CSS px. */
export const PREVIEW_W = 60;
export const PREVIEW_H = 16;
/** A wide preset keeps its look but fits the preview height. */
const MAX_PREVIEW_SIZE = 11;

const cache = new Map<SketchPresetId, string>();

/**
 * A real stroke of the preset, as a PNG data URL whose alpha is the stroke coverage: the page shows it as a CSS mask
 * over `currentColor`, so it follows the theme. The pressure rises and falls along the wave.
 */
export function sketchPreview(id: SketchPresetId): string {
  const known = cache.get(id);
  if (known) return known;
  const { hardness, ...texture } = PARAMS.paint.sketchPresets[id];
  const size = Math.min(MAX_PREVIEW_SIZE, TUNING.ui.brushDefaults.sketch.sizes[id]);
  const image = createRaster(PREVIEW_W, PREVIEW_H);
  const stroke = new Stroke({
    image,
    offset: { x: 0, y: 0 },
    mode: 'paint',
    color: { r: 0, g: 0, b: 0, a: 255 },
    size,
    hardness,
    opacity: 1,
    selection: null,
    texture,
  });
  const margin = size / 2 + 1;
  const amp = Math.max(0, PREVIEW_H / 2 - margin);
  const points: StrokePoint[] = [];
  for (let x = margin; x <= PREVIEW_W - margin; x += 1) {
    const t = (x - margin) / (PREVIEW_W - 2 * margin);
    points.push({ x, y: PREVIEW_H / 2 - Math.sin(t * Math.PI * 2) * amp, pressure: 0.2 + 0.8 * Math.sin(t * Math.PI) });
  }
  stroke.addPoints(points);
  stroke.end();
  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW_W;
  canvas.height = PREVIEW_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, PREVIEW_W, PREVIEW_H), 0, 0);
  const url = canvas.toDataURL('image/png');
  cache.set(id, url);
  return url;
}
