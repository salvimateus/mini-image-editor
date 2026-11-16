import { t } from '../i18n/index.ts';
import { healHole } from '../inpaint.ts';
import { isRenderedLayer } from '../layers.ts';
import { app } from '../state.svelte.ts';
import { TUNING } from '../tuning/index.ts';
import { createStrokeTool, SIZE_HINTS } from './brush.ts';
import type { ToolController } from './types.ts';

/**
 * Spot healing: paint over a spot, and on release the stroke area is filled from the pixels of the active layer around
 * it, with no source point. Each stroke is one undo step; the brush opacity blends the fill with the old pixels.
 */
export const healTool: ToolController = createStrokeTool({
  id: 'heal',
  mode: 'paint',
  aliased: false,
  sound: 'stamp',
  label: 'paint.history.heal',
  hints: [
    { keys: 'Drag', text: 'paint.hint.heal' },
    ...SIZE_HINTS,
    { keys: 'Shift+Click', text: 'paint.hint.line' },
    { keys: 'Esc', text: 'paint.hint.healCancel' },
  ],
  allow(doc) {
    const layer = doc.active;
    if (layer && layer.kind === 'raster' && !isRenderedLayer(layer)) return true;
    app.refuse(t('paint.toast.healLayer'));
    return false;
  },
  settle: {
    tint: TUNING.paint.healTint,
    run: ({ doc, layerId, coverage, opacity }) => void healHole(doc, layerId, coverage, 'paint.history.heal', opacity),
  },
});
