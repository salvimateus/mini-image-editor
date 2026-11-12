import { invertMask, rectMask, type Mask } from '../../core/mask.ts';
import { blitRaster, createRaster, intersectRect, readRect, unionRect } from '../../core/raster.ts';
import type { Rect, Rgba } from '../../core/types.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import { t, type TextKey } from '../i18n/index.ts';
import { layerRect, type RasterLayer } from '../layers.ts';
import * as sfx from '../sfx.ts';
import { app } from '../state.svelte.ts';
import { currentSelection } from '../tools/marquee-rect.ts';
import { cancelTransform } from '../tools/move.ts';
import type { ActionHandlers, SelectActionId } from './types.ts';

function hint(key: TextKey): void {
  app.refuse(t(key));
}

/** The selection of the open document; a short hint when there is none. */
function selectionOrHint(doc: EditorDoc): Mask | null {
  const selection = currentSelection(doc);
  if (!selection) hint('select.toast.noSelection');
  return selection;
}

/** The selection bounds in layer px, clipped to `area` (layer px). */
function selectionRect(selection: Mask, layer: { x: number; y: number }, area: Rect): Rect | null {
  const bounds = selection.bounds;
  if (!bounds) return null;
  return intersectRect({ x: bounds.x - layer.x, y: bounds.y - layer.y, w: bounds.w, h: bounds.h }, area);
}

/** Lowers the alpha of each pixel by the coverage of the selection. False when nothing changes. */
function eraseByCoverage(data: Uint8ClampedArray, rect: Rect, selection: Mask, ox: number, oy: number): boolean {
  let changed = false;
  for (let y = 0; y < rect.h; y++) {
    const docY = rect.y + oy + y;
    if (docY < 0 || docY >= selection.height) continue;
    for (let x = 0; x < rect.w; x++) {
      const docX = rect.x + ox + x;
      if (docX < 0 || docX >= selection.width) continue;
      const cover = selection.data[docY * selection.width + docX];
      const o = (y * rect.w + x) * 4 + 3;
      const alpha = data[o];
      if (cover === 0 || alpha === 0) continue;
      data[o] = Math.round((alpha * (255 - cover)) / 255);
      changed = true;
    }
  }
  return changed;
}

/** Paints `color` over each pixel with the coverage of the selection as its alpha (straight-alpha "over"). */
function fillByCoverage(data: Uint8ClampedArray, rect: Rect, selection: Mask, ox: number, oy: number, color: Rgba): void {
  for (let y = 0; y < rect.h; y++) {
    const docY = rect.y + oy + y;
    if (docY < 0 || docY >= selection.height) continue;
    for (let x = 0; x < rect.w; x++) {
      const docX = rect.x + ox + x;
      if (docX < 0 || docX >= selection.width) continue;
      const cover = selection.data[docY * selection.width + docX];
      if (cover === 0) continue;
      const o = (y * rect.w + x) * 4;
      const sa = cover / 255;
      const da = data[o + 3] / 255;
      const keep = da * (1 - sa);
      const outA = sa + keep;
      data[o] = (color.r * sa + data[o] * keep) / outA;
      data[o + 1] = (color.g * sa + data[o + 1] * keep) / outA;
      data[o + 2] = (color.b * sa + data[o + 2] * keep) / outA;
      data[o + 3] = outA * 255;
    }
  }
}

/** Fills the selection on the paint target; a target smaller than the selection grows to hold it. */
function fillSelection(doc: EditorDoc, selection: Mask, target: RasterLayer, color: Rgba): void {
  const bounds = selection.bounds;
  if (!bounds) return;
  const current = layerRect(target);
  const covers = bounds.x >= current.x && bounds.y >= current.y && bounds.x + bounds.w <= current.x + current.w && bounds.y + bounds.h <= current.y + current.h;
  if (covers) {
    const rect = selectionRect(selection, target, { x: 0, y: 0, w: target.image.width, h: target.image.height });
    if (!rect) return;
    const before = readRect(target.image, rect);
    const after = before.slice();
    fillByCoverage(after, rect, selection, target.x, target.y, color);
    doc.commitPatch(target.id, { rect, before, after }, 'select.history.fill');
    return;
  }
  const area = unionRect(current, bounds);
  const image = createRaster(area.w, area.h);
  blitRaster(target.image, { x: 0, y: 0, w: target.image.width, h: target.image.height }, image, target.x - area.x, target.y - area.y);
  const rect = { x: bounds.x - area.x, y: bounds.y - area.y, w: bounds.w, h: bounds.h };
  const pixels = readRect(image, rect);
  fillByCoverage(pixels, rect, selection, area.x, area.y, color);
  blitRaster({ width: rect.w, height: rect.h, data: pixels }, { x: 0, y: 0, w: rect.w, h: rect.h }, image, rect.x, rect.y);
  doc.replaceImage(target.id, image, { x: area.x, y: area.y }, 'select.history.fill');
}

/** Ctrl+A, Ctrl+D, Ctrl+Shift+I, Delete and Alt+Backspace. */
export const selectActions: ActionHandlers<SelectActionId> = {
  'select.all': () => {
    const doc = app.doc;
    if (!doc) return;
    cancelTransform(true);
    doc.setSelection(rectMask(doc.width, doc.height, { x: 0, y: 0, w: doc.width, h: doc.height }), 'select.history.all');
    sfx.play('select');
  },
  'select.none': () => {
    const doc = app.doc;
    if (!doc) return;
    if (!doc.selection) {
      sfx.play('cancel');
      return;
    }
    doc.setSelection(null, 'select.history.none');
    sfx.play('select');
  },
  'select.invert': () => {
    const doc = app.doc;
    if (!doc) return;
    const selection = selectionOrHint(doc);
    if (!selection) return;
    const inverse = invertMask(selection, doc.width, doc.height);
    doc.setSelection(inverse.bounds ? inverse : null, 'select.history.invert');
    sfx.play('select');
  },
  'select.erase': () => {
    const doc = app.doc;
    if (!doc) return;
    const active = doc.active;
    // With no selection, Delete removes a whole text or shape layer: it has no pixels of its own to erase.
    if (!currentSelection(doc) && active && (active.kind === 'text' || active.kind === 'shape')) {
      cancelTransform(true);
      if (doc.layers.length <= 1) {
        hint('select.toast.lastLayer');
        return;
      }
      doc.removeLayer(active.id);
      sfx.play('delete');
      return;
    }
    const selection = selectionOrHint(doc);
    if (!selection) return;
    cancelTransform(true);
    const layer = doc.active;
    if (!layer || layer.kind !== 'raster' || layer.generator) {
      hint('select.toast.notRaster');
      return;
    }
    const rect = selectionRect(selection, layer, { x: 0, y: 0, w: layer.image.width, h: layer.image.height });
    const before = rect ? readRect(layer.image, rect) : null;
    const after = before ? before.slice() : null;
    if (!rect || !before || !after || !eraseByCoverage(after, rect, selection, layer.x, layer.y)) {
      hint('select.toast.nothingErased');
      return;
    }
    doc.commitPatch(layer.id, { rect, before, after }, 'select.history.erase');
    sfx.play('delete');
  },
  'select.fill': () => {
    const doc = app.doc;
    if (!doc) return;
    const selection = selectionOrHint(doc);
    if (!selection) return;
    cancelTransform(true);
    const color = app.fg;
    doc.batch('select.history.fill', () => fillSelection(doc, selection, doc.paintTarget(), color));
    sfx.play('fill');
  },
};
