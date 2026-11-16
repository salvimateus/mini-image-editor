import { opaqueBounds } from '../../core/raster.ts';
import type { RasterImage, Rect } from '../../core/types.ts';
import type { EditorDoc } from '../../app/doc.svelte.ts';
import type { Layer } from '../../app/layers.ts';
import { app } from '../../app/state.svelte.ts';
import { groupDragging } from '../../app/tools/move.ts';
import { snap, STAGE_COLORS } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

const localBounds = new WeakMap<RasterImage, { version: number; rect: Rect | null }>();

/**
 * The visible bounds of the layer in document px. A group drag changes the version on each move but never the pixels,
 * so it keeps the bounds of the press instead of a scan of each layer on each frame.
 */
function boundsOf(doc: EditorDoc, layer: Layer): Rect | null {
  let entry = localBounds.get(layer.image);
  if (!entry || (entry.version !== doc.version && !groupDragging())) {
    entry = { version: doc.version, rect: opaqueBounds(layer.image) };
    localBounds.set(layer.image, entry);
  }
  const rect = entry.rect;
  return rect ? { x: rect.x + layer.x, y: rect.y + layer.y, w: rect.w, h: rect.h } : null;
}

$effect.root(() => {
  // The fx canvas draws only when asked: a new selection, tool or document asks once.
  $effect(() => {
    void app.tool;
    void app.doc?.selectedIds;
    app.stage?.invalidateFx();
  });
});

/** A thin outline around each selected layer that is not the active one, while the Move tool is active. */
export const selectedLayersOverlay: SceneOverlay = {
  z: 62,
  drawFx(fx, host) {
    const doc = app.doc;
    if (!doc || app.tool !== 'move' || doc.selectedIds.length < 2) return false;
    const camera = host.camera;
    const dpr = host.dpr;
    fx.save();
    fx.lineWidth = 1;
    for (const id of doc.selectedIds) {
      if (id === doc.activeId) continue;
      const layer = doc.layer(id);
      const rect = layer ? boundsOf(doc, layer) : null;
      if (!rect) continue;
      const a = camera.imageToScreen(rect.x, rect.y);
      const b = camera.imageToScreen(rect.x + rect.w, rect.y + rect.h);
      const x0 = snap(a.x, dpr);
      const y0 = snap(a.y, dpr);
      const w = snap(b.x, dpr) - x0;
      const h = snap(b.y, dpr) - y0;
      fx.setLineDash([]);
      fx.strokeStyle = STAGE_COLORS.black;
      fx.strokeRect(x0 + 1, y0 + 1, w, h);
      fx.setLineDash([4, 3]);
      fx.strokeStyle = STAGE_COLORS.accent;
      fx.strokeRect(x0, y0, w, h);
    }
    fx.restore();
    return false;
  },
};
