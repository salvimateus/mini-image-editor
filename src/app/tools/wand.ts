import { get } from 'svelte/store';
import { flatten } from '../../core/composite.ts';
import { floodMask } from '../../core/fill.ts';
import { featherMask } from '../../core/mask.ts';
import type { RasterImage } from '../../core/types.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import { app } from '../state.svelte.ts';
import { applySelection, clickSelection, modeHints, pressMode, selectSettings } from './marquee-rect.ts';
import type { ToolController } from './types.ts';

let cache: { doc: EditorDoc; version: number; image: RasterImage } | null = null;

/**
 * The composite of the visible layers without the generated ones, kept while the document does not change. A vignette
 * changes every pixel a little, so a flat area under it would not match.
 */
function composite(doc: EditorDoc): RasterImage {
  if (cache && cache.doc === doc && cache.version === doc.version) return cache.image;
  const layers = doc.layers
    .filter((layer) => layer.visible && layer.opacity > 0 && !(layer.kind === 'raster' && layer.generator))
    .map((layer) => ({ image: layer.image, x: layer.x, y: layer.y, opacity: layer.opacity }));
  const image = flatten(doc.width, doc.height, layers);
  cache = { doc, version: doc.version, image };
  return image;
}

/** A click selects the similar colors of the composite under the pointer. */
export const wandTool: ToolController = {
  id: 'wand',
  hints: [{ keys: 'Click', text: 'select.hint.wand' }, ...modeHints('Click')],
  cursor: () => 'crosshair',
  down(p) {
    const doc = app.doc;
    if (!doc) return false;
    const op = pressMode(p);
    const x = Math.floor(p.ix);
    const y = Math.floor(p.iy);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) {
      clickSelection(doc, op);
      return false;
    }
    const { tolerance, contiguous, feather } = get(selectSettings);
    let mask = floodMask(composite(doc), x, y, { tolerance, contiguous, antiAlias: true });
    if (feather > 0) mask = featherMask(mask, feather);
    applySelection(doc, mask, op);
    return false;
  },
  deactivate() {
    cache = null;
  },
};
