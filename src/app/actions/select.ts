import { invertMask, rectMask, type Mask } from '../../core/mask.ts';
import { blitRaster, createRaster, cropRaster, intersectRect, opaqueBounds, readRect, unionRect } from '../../core/raster.ts';
import type { Patch, RasterImage, Rect, Rgba } from '../../core/types.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import { t, type TextKey } from '../i18n/index.ts';
import { healHole, type HoleCover } from '../inpaint.ts';
import { layerRect, type Layer, type RasterLayer } from '../layers.ts';
import * as sfx from '../sfx.ts';
import { app } from '../state.svelte.ts';
import { currentSelection } from '../tools/marquee-rect.ts';
import { cancelTransform } from '../tools/move.ts';
import type { ActionHandlers, SelectActionId } from './types.ts';

export function hint(key: TextKey): void {
  app.refuse(t(key));
}

/** The selection of the open document; a short hint when there is none. */
export function selectionOrHint(doc: EditorDoc): Mask | null {
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

/** A layer whose own pixels the selection can erase: a raster layer that no generator renders. */
export function erasableLayer(layer: Layer | null): layer is RasterLayer {
  return layer !== null && layer.kind === 'raster' && !layer.generator;
}

/** The patch that erases the selection from the layer by coverage; null when no pixel changes. */
export function erasePatch(layer: RasterLayer, selection: Mask): Patch | null {
  const rect = selectionRect(selection, layer, { x: 0, y: 0, w: layer.image.width, h: layer.image.height });
  if (!rect) return null;
  const before = readRect(layer.image, rect);
  const after = before.slice();
  return eraseByCoverage(after, rect, selection, layer.x, layer.y) ? { rect, before, after } : null;
}

/** Pixels taken from a layer, with their top-left corner in document px. */
export interface LayerPiece { image: RasterImage; x: number; y: number }

/**
 * The pixels of the layer under the selection, with alpha scaled by coverage, cropped to the opaque part. With no
 * selection, the whole layer cropped to its opaque part. Null when no pixel is left.
 */
export function selectionPiece(layer: Layer, selection: Mask | null): LayerPiece | null {
  const area = { x: 0, y: 0, w: layer.image.width, h: layer.image.height };
  const rect = selection ? selectionRect(selection, layer, area) : area;
  if (!rect) return null;
  const data = readRect(layer.image, rect);
  if (selection) {
    for (let y = 0; y < rect.h; y++) {
      const docY = rect.y + layer.y + y;
      for (let x = 0; x < rect.w; x++) {
        const docX = rect.x + layer.x + x;
        const inside = docY >= 0 && docY < selection.height && docX >= 0 && docX < selection.width;
        const cover = inside ? selection.data[docY * selection.width + docX] : 0;
        const o = (y * rect.w + x) * 4;
        if (cover === 255) continue;
        const alpha = Math.round((data[o + 3] * cover) / 255);
        if (alpha === 0) data.fill(0, o, o + 4);
        else data[o + 3] = alpha;
      }
    }
  }
  const full: RasterImage = { width: rect.w, height: rect.h, data };
  const tight = opaqueBounds(full);
  if (!tight) return null;
  return { image: cropRaster(full, tight), x: layer.x + rect.x + tight.x, y: layer.y + rect.y + tight.y };
}

/** The coverage of the selection over the layer image, in layer px; null when it covers no pixel of the image. */
function selectionHole(layer: RasterLayer, selection: Mask): HoleCover | null {
  const rect = selectionRect(selection, layer, { x: 0, y: 0, w: layer.image.width, h: layer.image.height });
  if (!rect) return null;
  const data = new Uint8Array(rect.w * rect.h);
  let covered = false;
  for (let y = 0; y < rect.h; y++) {
    const docY = rect.y + layer.y + y;
    if (docY < 0 || docY >= selection.height) continue;
    for (let x = 0; x < rect.w; x++) {
      const docX = rect.x + layer.x + x;
      if (docX < 0 || docX >= selection.width) continue;
      const cover = selection.data[docY * selection.width + docX];
      if (cover === 0) continue;
      data[y * rect.w + x] = cover;
      covered = true;
    }
  }
  return covered ? { rect, data } : null;
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

/** Ctrl+A, Ctrl+D, Ctrl+Shift+I, Delete, Alt+Backspace and Shift+Backspace. */
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
    // With no selection, Delete removes a whole text, shape or SVG layer: it has no pixels of its own to erase.
    if (!currentSelection(doc) && active && (active.kind === 'text' || active.kind === 'shape' || active.kind === 'svg')) {
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
    if (!erasableLayer(layer)) {
      hint('select.toast.notRaster');
      return;
    }
    const patch = erasePatch(layer, selection);
    if (!patch) {
      hint('select.toast.nothingErased');
      return;
    }
    doc.commitPatch(layer.id, patch, 'select.history.erase');
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
  'select.contentFill': () => {
    const doc = app.doc;
    if (!doc) return;
    const selection = selectionOrHint(doc);
    if (!selection) return;
    cancelTransform(true);
    const layer = doc.active;
    if (!erasableLayer(layer)) return hint('select.toast.fillLayer');
    if (!layer.visible) return hint('select.toast.fillHidden');
    const hole = selectionHole(layer, selection);
    if (!hole) return hint('select.toast.fillOutside');
    void healHole(doc, layer.id, hole, 'select.history.contentFill');
  },
};
