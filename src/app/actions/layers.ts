import { flatten } from '../../core/composite.ts';
import { createRaster, unionRect } from '../../core/raster.ts';
import { alignTarget, noteAligned } from '../align-reference.svelte.ts';
import { t, type TextKey } from '../i18n/index.ts';
import { createRasterLayer, duplicateLayer, layerRect } from '../layers.ts';
import * as sfx from '../sfx.ts';
import { app } from '../state.svelte.ts';
import { applyTransform, cancelTransform, layerBounds, startTransform, transformBox } from '../tools/move.ts';
import { pickImageFiles } from './pick-files.ts';
import type { ActionHandler, ActionHandlers, LayersActionId } from './types.ts';

function hint(key: TextKey): void {
  app.refuse(t(key));
}

type Edge = 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom';

/** Moves the active layer so that its visible bounds touch an edge or the center of the align reference. */
function align(edge: Edge): ActionHandler {
  return () => {
    const doc = app.doc;
    if (!doc) return;
    cancelTransform(true);
    const layer = doc.active;
    if (!layer) return hint('select.toast.noLayer');
    const b = layerBounds(doc, layer);
    if (!b) return hint('select.toast.emptyLayer');
    const target = alignTarget(doc);
    const r = target.rect;
    let dx = 0;
    let dy = 0;
    if (edge === 'left') dx = r.x - b.x;
    else if (edge === 'centerH') dx = Math.round(r.x + (r.w - b.w) / 2) - b.x;
    else if (edge === 'right') dx = r.x + r.w - (b.x + b.w);
    else if (edge === 'top') dy = r.y - b.y;
    else if (edge === 'centerV') dy = Math.round(r.y + (r.h - b.h) / 2) - b.y;
    else dy = r.y + r.h - (b.y + b.h);
    if (dx !== 0 || dy !== 0) doc.batch('select.history.align', () => doc.setLayerProps(layer.id, { x: layer.x + dx, y: layer.y + dy }));
    noteAligned(doc, target);
    sfx.play('tick');
  };
}

/** New, duplicate, delete, merge down, transform, add image and the six align actions. */
export const layersActions: ActionHandlers<LayersActionId> = {
  'layer.new': () => {
    const doc = app.doc;
    if (!doc) return;
    cancelTransform(true);
    doc.addLayer(createRasterLayer(doc.nextLayerName(), createRaster(doc.width, doc.height), 0, 0));
    sfx.play('layer');
  },
  'layer.duplicate': () => {
    const doc = app.doc;
    if (!doc) return;
    cancelTransform(true);
    const layer = doc.active;
    if (!layer) return hint('select.toast.noLayer');
    doc.addLayer(duplicateLayer(layer, t('select.layer.copyName', { name: layer.name })), undefined, 'select.history.duplicate');
    sfx.play('layer');
  },
  'layer.delete': () => {
    const doc = app.doc;
    if (!doc) return;
    cancelTransform(true);
    const layer = doc.active;
    if (!layer) return hint('select.toast.noLayer');
    if (doc.layers.length <= 1) return hint('select.toast.lastLayer');
    doc.removeLayer(layer.id);
    sfx.play('delete');
  },
  'layer.mergeDown': () => {
    const doc = app.doc;
    if (!doc) return;
    cancelTransform(true);
    const layer = doc.active;
    if (!layer) return hint('select.toast.noLayer');
    const index = doc.indexOf(layer.id);
    if (index <= 0) return hint('select.toast.noBelow');
    const below = doc.layers[index - 1];
    if (!layer.visible || !below.visible) return hint('select.toast.mergeHidden');
    const area = unionRect(layerRect(below), layerRect(layer));
    const image = flatten(area.w, area.h, [
      { image: below.image, x: below.x - area.x, y: below.y - area.y, opacity: below.opacity },
      { image: layer.image, x: layer.x - area.x, y: layer.y - area.y, opacity: layer.opacity },
    ]);
    const merged = createRasterLayer(below.name, image, area.x, area.y);
    doc.batch('select.history.mergeDown', () => {
      doc.removeLayer(layer.id);
      doc.removeLayer(below.id);
      doc.addLayer(merged, index - 1);
    });
    sfx.play('layer');
  },
  'layer.transform': () => {
    if (transformBox()) void applyTransform();
    else startTransform();
  },
  'layer.addImage': () => {
    void pickImageFiles().then((files) => {
      if (files.length > 0) void app.openFiles(files, 'layer');
    });
  },
  'layer.alignLeft': align('left'),
  'layer.alignCenterH': align('centerH'),
  'layer.alignRight': align('right'),
  'layer.alignTop': align('top'),
  'layer.alignCenterV': align('centerV'),
  'layer.alignBottom': align('bottom'),
};
