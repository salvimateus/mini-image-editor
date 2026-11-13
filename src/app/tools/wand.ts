import { get } from 'svelte/store';
import { floodMask } from '../../core/fill.ts';
import { featherMask } from '../../core/mask.ts';
import { cropRaster } from '../../core/raster.ts';
import type { RasterImage } from '../../core/types.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import { t } from '../i18n/index.ts';
import type { Layer } from '../layers.ts';
import { app } from '../state.svelte.ts';
import { applySelection, clickSelection, modeHints, pressMode, selectSettings } from './marquee-rect.ts';
import type { ToolController } from './types.ts';

let cache: { doc: EditorDoc; version: number; layerId: number; image: RasterImage } | null = null;

/**
 * The raw pixels of the layer at document size (outside its image = transparent, no opacity), kept while the document
 * and the active layer do not change.
 */
function layerSource(doc: EditorDoc, layer: Layer): RasterImage {
  if (cache && cache.doc === doc && cache.version === doc.version && cache.layerId === layer.id) return cache.image;
  const image = cropRaster(layer.image, { x: -layer.x, y: -layer.y, w: doc.width, h: doc.height });
  cache = { doc, version: doc.version, layerId: layer.id, image };
  return image;
}

/** A click selects the similar colors of the active layer under the pointer. */
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
    const layer = doc.active;
    if (!layer || x < 0 || y < 0 || x >= doc.width || y >= doc.height) {
      clickSelection(doc, op);
      return false;
    }
    if (!layer.visible) {
      app.refuse(t('select.toast.wandHidden'));
      return false;
    }
    const { tolerance, contiguous, feather } = get(selectSettings);
    let mask = floodMask(layerSource(doc, layer), x, y, { tolerance, contiguous, antiAlias: true });
    if (feather > 0) mask = featherMask(mask, feather);
    applySelection(doc, mask, op);
    return false;
  },
  deactivate() {
    cache = null;
  },
};
