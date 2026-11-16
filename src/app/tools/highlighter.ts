import { createRaster } from '../../core/raster.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import { t, type TextKey } from '../i18n/index.ts';
import { createRasterLayer, type RasterLayer } from '../layers.ts';
import { createStrokeTool, SIZE_HINTS } from './brush.ts';
import type { ToolController } from './types.ts';

const LABEL: TextKey = 'paint.history.highlighter';

/** The highlight layers that this tool added in each document. Layer ids are unique in the session. */
const ownLayers = new WeakMap<EditorDoc, Set<number>>();

function coversStage(layer: RasterLayer, doc: EditorDoc): boolean {
  return layer.x <= 0 && layer.y <= 0 && layer.x + layer.image.width >= doc.width && layer.y + layer.image.height >= doc.height;
}

/** The active layer while it is a visible highlight layer of this tool that still covers the stage; else a new one above it. */
function highlightTarget(doc: EditorDoc): { layer: RasterLayer; created: boolean } {
  const own = ownLayers.get(doc) ?? new Set<number>();
  ownLayers.set(doc, own);
  const active = doc.active;
  if (active && active.kind === 'raster' && !active.generator && active.visible && active.opacity > 0 && own.has(active.id) && coversStage(active, doc)) {
    return { layer: active, created: false };
  }
  const layer = createRasterLayer(t('paint.highlightLayerName'), createRaster(doc.width, doc.height), 0, 0);
  doc.addLayer(layer, undefined, LABEL);
  own.add(layer.id);
  // The document can own a copy of the image: paint the layer that it holds.
  return { layer: (doc.layer(layer.id) as RasterLayer | null) ?? layer, created: true };
}

/** Translucent strokes in the foreground color on a highlight layer above the active layer; the pixels below never change. */
export const highlighterTool: ToolController = createStrokeTool({
  id: 'highlighter',
  mode: 'paint',
  aliased: false,
  sound: 'paint',
  label: LABEL,
  hints: [
    { keys: 'Drag', text: 'paint.hint.highlight' },
    ...SIZE_HINTS,
    { keys: 'Alt+Click', text: 'paint.hint.pick' },
    { keys: 'Shift+Click', text: 'paint.hint.line' },
  ],
  target: highlightTarget,
});
