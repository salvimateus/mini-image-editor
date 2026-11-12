import { fromStore, writable } from 'svelte/store';
import { coverage, type Mask } from '../../core/mask.ts';
import { createRaster, cropRaster, intersectRect, opaqueBounds, readRect } from '../../core/raster.ts';
import type { Point, RasterImage, Rect } from '../../core/types.ts';
import type { StagePointer } from '../../ui/stage-renderer.ts';
import type { EditorDoc, LayerPreview } from '../doc.svelte.ts';
import { t, type TextKey } from '../i18n/index.ts';
import { createRasterLayer, type Layer, type RasterLayer } from '../layers.ts';
import * as sfx from '../sfx.ts';
import { clearSnapFeedback, snapBoxLive } from '../snap-feedback.svelte.ts';
import { app } from '../state.svelte.ts';
import { renderTextLayer, scaleTextSpec } from '../text-render.ts';
import { TUNING } from '../tuning/index.ts';
import { currentSelection, leftSlop, stageDragging } from './marquee-rect.ts';
import type { Hint, ToolController } from './types.ts';
import { keyLabels } from '../shortcuts.ts';

// ----- visible bounds -----

const boundsCache = new WeakMap<RasterImage, { version: number; rect: Rect | null }>();

/** The visible bounds (alpha > 0) of the layer in document px, kept while the document version stays. */
export function layerBounds(doc: EditorDoc, layer: Layer): Rect | null {
  const version = doc.version;
  let entry = boundsCache.get(layer.image);
  if (!entry || entry.version !== version) {
    entry = { version, rect: opaqueBounds(layer.image) };
    boundsCache.set(layer.image, entry);
  }
  const rect = entry.rect;
  return rect ? { x: rect.x + layer.x, y: rect.y + layer.y, w: rect.w, h: rect.h } : null;
}

/** The top visible layer with a pixel of alpha > 0 at the document point. */
function layerAt(doc: EditorDoc, x: number, y: number): Layer | null {
  const px = Math.floor(x);
  const py = Math.floor(y);
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i];
    if (!layer.visible || layer.opacity <= 0) continue;
    const lx = px - layer.x;
    const ly = py - layer.y;
    const { width, height, data } = layer.image;
    if (lx < 0 || ly < 0 || lx >= width || ly >= height) continue;
    if (data[(ly * width + lx) * 4 + 3] > 0) return layer;
  }
  return null;
}

/** A display canvas of the image. Never read pixels back from it. */
function spriteOf(image: RasterImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, image.width);
  canvas.height = Math.max(1, image.height);
  const ctx = canvas.getContext('2d');
  if (ctx && image.width > 0 && image.height > 0) {
    ctx.putImageData(new ImageData(image.data.slice() as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
  }
  return canvas;
}

function releaseSprite(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function hint(key: TextKey): void {
  app.refuse(t(key));
}

// ----- floating sprite: what the transform overlay draws above the stage -----

export interface FloatingSprite { canvas: HTMLCanvasElement; rect: Rect; opacity: number }

// ----- transform session -----

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

interface TransformSession {
  doc: EditorDoc;
  layerId: number;
  image: RasterImage;
  text: boolean;
  /** The visible bounds at the start, in document px. */
  origin: Rect;
  /** The box now, in document px (not rounded). */
  box: Rect;
  sprite: HTMLCanvasElement;
  preview: LayerPreview;
  opacity: number;
  busy: boolean;
}

interface BoxDrag { handle: Handle | 'move'; start: StagePointer; startBox: Rect }

let session: TransformSession | null = null;
let boxDrag: BoxDrag | null = null;

/** True while Ctrl+T runs. */
export const transformOn = writable(false);
const transformView = fromStore(transformOn);

function endSession(): void {
  const s = session;
  if (!s) return;
  session = null;
  boxDrag = null;
  if (s.doc.preview === s.preview) s.doc.setPreview(null);
  releaseSprite(s.sprite);
  transformOn.set(false);
  clearSnapFeedback();
  app.stage?.invalidateFx();
}

/** The session, or null (and the session ends) when an undo, a new document or a new image of the layer broke it. */
function liveSession(): TransformSession | null {
  const s = session;
  if (!s) return null;
  const layer = s.doc.layer(s.layerId);
  if (app.doc !== s.doc || s.doc.preview !== s.preview || !layer || layer.image !== s.image) {
    endSession();
    return null;
  }
  return s;
}

export function transformBox(): Rect | null {
  return liveSession()?.box ?? null;
}

/** Starts Ctrl+T on the active layer: a box with 8 handles around its visible bounds. */
export function startTransform(): void {
  const doc = app.doc;
  if (!doc) return;
  if (liveSession()) return;
  const layer = doc.active;
  if (!layer) return hint('select.toast.noLayer');
  if (layer.kind === 'raster' && layer.generator) return hint('select.toast.generated');
  const bounds = layerBounds(doc, layer);
  if (!bounds) return hint('select.toast.emptyLayer');
  cancelLift();
  // setTool plays the tool sound; the transform sound below would double it.
  const switched = app.tool !== 'move';
  if (switched) app.setTool('move');
  const local = { x: bounds.x - layer.x, y: bounds.y - layer.y, w: bounds.w, h: bounds.h };
  // An empty image in place of the whole layer: the overlay draws the scaled sprite instead.
  const preview: LayerPreview = { layerId: layer.id, image: createRaster(1, 1), rect: { x: 0, y: 0, w: layer.image.width, h: layer.image.height }, scale: 1 };
  session = {
    doc,
    layerId: layer.id,
    image: layer.image,
    text: layer.kind === 'text',
    origin: bounds,
    box: { ...bounds },
    sprite: spriteOf(cropRaster(layer.image, local)),
    preview,
    opacity: layer.opacity,
    busy: false,
  };
  doc.setPreview(preview);
  transformOn.set(true);
  if (!switched) sfx.play('tool');
  app.stage?.invalidateFx();
}

/** `quiet`: an action that ends the transform before its own change plays only its own sound. */
export function cancelTransform(quiet = false): void {
  if (!session || session.busy) return;
  endSession();
  if (!quiet) sfx.play('cancel');
}

function roundBox(box: Rect): Rect {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  return { x, y, w: Math.max(1, Math.round(box.x + box.w) - x), h: Math.max(1, Math.round(box.y + box.h) - y) };
}

/** Applies the box: a raster layer is resampled, a text layer renders again at the new size. One undo step. */
export async function applyTransform(): Promise<void> {
  const s = liveSession();
  if (!s || s.busy) return;
  const layer = s.doc.layer(s.layerId);
  if (!layer) return endSession();
  const box = roundBox(s.box);
  const { origin, doc } = s;
  const sameSize = box.w === origin.w && box.h === origin.h;
  if (sameSize && box.x === origin.x && box.y === origin.y) {
    endSession();
    sfx.play('tick');
    return;
  }
  if (sameSize) {
    endSession();
    doc.batch('select.history.transform', () => doc.setLayerProps(layer.id, { x: layer.x + box.x - origin.x, y: layer.y + box.y - origin.y }));
    sfx.play('tick');
    return;
  }
  s.busy = true;
  try {
    if (layer.kind === 'text') {
      const spec = scaleTextSpec(layer.spec, box.w / origin.w);
      const image = await app.track(renderTextLayer(spec));
      if (session !== s || !liveSession()) return;
      const bounds = opaqueBounds(image);
      const at = { x: box.x - (bounds?.x ?? 0), y: box.y - (bounds?.y ?? 0) };
      endSession();
      doc.batch('select.history.transform', () => {
        doc.setTextSpec(layer.id, spec, image);
        doc.setLayerProps(layer.id, at);
      });
    } else {
      const local = { x: origin.x - layer.x, y: origin.y - layer.y, w: origin.w, h: origin.h };
      const resized = await app.track(app.engine.resize(cropRaster(layer.image, local), box.w, box.h, 'auto'));
      if (session !== s || !liveSession()) return;
      endSession();
      doc.replaceImage(layer.id, resized, { x: box.x, y: box.y }, 'select.history.transform');
    }
    sfx.play('resize');
  } catch (error) {
    app.fail(error);
  } finally {
    if (session === s) endSession();
  }
}

function handlePoint(box: Rect, handle: Handle): Point {
  const x = handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.w : box.x + box.w / 2;
  const y = handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.h : box.y + box.h / 2;
  return { x, y };
}

/** The handle points of the box in document px, in HANDLES order. */
export function handlePoints(box: Rect): Point[] {
  return HANDLES.map((handle) => handlePoint(box, handle));
}

/** The handle under the pointer, 'move' inside the box, or null. */
function hitBox(p: StagePointer): Handle | 'move' | null {
  const stage = app.stage;
  const box = transformBox();
  if (!stage || !box) return null;
  const reach = TUNING.select.handle.hitPx;
  for (const handle of HANDLES) {
    const point = handlePoint(box, handle);
    const screen = stage.docToScreen(point.x, point.y);
    if (Math.abs(p.sx - screen.x) <= reach && Math.abs(p.sy - screen.y) <= reach) return handle;
  }
  const inside = p.ix >= box.x && p.iy >= box.y && p.ix <= box.x + box.w && p.iy <= box.y + box.h;
  return inside ? 'move' : null;
}

const HANDLE_CURSORS: Record<Handle | 'move', string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  move: 'move',
};

/** The box after a drag of `handle` to (px, py). Proportional unless `free`; an edge handle keeps the other axis centered. */
function resizeBox(start: Rect, handle: Handle, px: number, py: number, free: boolean): Rect {
  const min = TUNING.select.transformMinPx;
  const left = start.x;
  const top = start.y;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  let x0 = west ? Math.min(px, right - min) : left;
  let x1 = east ? Math.max(px, left + min) : right;
  let y0 = north ? Math.min(py, bottom - min) : top;
  let y1 = south ? Math.max(py, top + min) : bottom;
  if (!free) {
    const horizontal = west || east;
    const vertical = north || south;
    let scale: number;
    if (horizontal && vertical) scale = Math.max((x1 - x0) / start.w, (y1 - y0) / start.h);
    else if (horizontal) scale = (x1 - x0) / start.w;
    else scale = (y1 - y0) / start.h;
    scale = Math.max(scale, min / Math.min(start.w, start.h));
    const w = start.w * scale;
    const h = start.h * scale;
    if (west) x0 = right - w;
    else if (east) x1 = left + w;
    else {
      x0 = left + start.w / 2 - w / 2;
      x1 = x0 + w;
    }
    if (north) y0 = bottom - h;
    else if (south) y1 = top + h;
    else {
      y0 = top + start.h / 2 - h / 2;
      y1 = y0 + h;
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The pointer chain of the transform overlay: true while a session runs, so the press never reaches the tool. */
export function transformPointerDown(p: StagePointer): boolean {
  const s = liveSession();
  if (!s) return false;
  if (s.busy) return true;
  const hit = hitBox(p);
  boxDrag = hit ? { handle: hit, start: p, startBox: { ...s.box } } : null;
  return true;
}

export function transformPointerMove(p: StagePointer): void {
  const s = liveSession();
  const drag = boxDrag;
  if (!s || !drag || s.busy) return;
  const dx = p.ix - drag.start.ix;
  const dy = p.iy - drag.start.iy;
  if (drag.handle === 'move') {
    const moved = { ...drag.startBox, x: Math.round(drag.startBox.x + dx), y: Math.round(drag.startBox.y + dy) };
    const snap = snapBoxLive(moved, p.ctrl);
    s.box = { ...moved, x: moved.x + Math.round(snap.dx), y: moved.y + Math.round(snap.dy) };
  } else {
    const point = handlePoint(drag.startBox, drag.handle);
    s.box = resizeBox(drag.startBox, drag.handle, point.x + dx, point.y + dy, p.shift && !s.text);
  }
  app.stage?.invalidateFx();
}

export function transformPointerUp(): void {
  if (!boxDrag) return;
  boxDrag = null;
  clearSnapFeedback();
  app.stage?.invalidateFx();
}

// ----- move drags -----

interface LayerDrag { kind: 'layer'; layerId: number; start: StagePointer; origin: Point; bounds: Rect; key: string; moved: boolean }

interface LiftDrag {
  kind: 'lift';
  layerId: number;
  start: StagePointer;
  moved: boolean;
  /** The lifted area in layer px, with the pixels before and after (the hole). */
  rect: Rect;
  before: Uint8ClampedArray;
  after: Uint8ClampedArray;
  lifted: RasterImage;
  /** The top-left corner of `lifted` in document px, before the drag. */
  at: Point;
  offset: Point;
  opacity: number;
  sprite: HTMLCanvasElement;
  preview: LayerPreview;
}

let drag: LayerDrag | LiftDrag | null = null;
let dragSerial = 0;

/** The pixels of the selection on a raster layer, lifted by coverage; null when the selection holds no pixel of it. */
function prepareLift(layer: RasterLayer, selection: Mask, start: StagePointer): LiftDrag | null {
  const bounds = selection.bounds;
  if (!bounds) return null;
  const { image } = layer;
  const rect = intersectRect({ x: bounds.x - layer.x, y: bounds.y - layer.y, w: bounds.w, h: bounds.h }, { x: 0, y: 0, w: image.width, h: image.height });
  if (!rect) return null;
  const before = readRect(image, rect);
  const after = before.slice();
  const lifted = new Uint8ClampedArray(before.length);
  let found = false;
  for (let y = 0; y < rect.h; y++) {
    const docY = rect.y + layer.y + y;
    for (let x = 0; x < rect.w; x++) {
      const o = (y * rect.w + x) * 4;
      const alpha = before[o + 3];
      if (alpha === 0) continue;
      const cover = coverage(selection, rect.x + layer.x + x, docY);
      if (cover === 0) continue;
      const take = Math.round((alpha * cover) / 255);
      if (take === 0) continue;
      lifted[o] = before[o];
      lifted[o + 1] = before[o + 1];
      lifted[o + 2] = before[o + 2];
      lifted[o + 3] = take;
      after[o + 3] = alpha - take;
      found = true;
    }
  }
  if (!found) return null;
  const full: RasterImage = { width: rect.w, height: rect.h, data: lifted };
  const tight = opaqueBounds(full) ?? { x: 0, y: 0, w: rect.w, h: rect.h };
  const piece = cropRaster(full, tight);
  return {
    kind: 'lift',
    layerId: layer.id,
    start,
    moved: false,
    rect,
    before,
    after,
    lifted: piece,
    at: { x: layer.x + rect.x + tight.x, y: layer.y + rect.y + tight.y },
    offset: { x: 0, y: 0 },
    opacity: layer.opacity,
    sprite: spriteOf(piece),
    preview: { layerId: layer.id, image: { width: rect.w, height: rect.h, data: after }, rect, scale: 1 },
  };
}

function cancelLift(): void {
  const current = drag;
  if (!current || current.kind !== 'lift') return;
  drag = null;
  const doc = app.doc;
  if (doc && doc.preview === current.preview) doc.setPreview(null);
  releaseSprite(current.sprite);
  stageDragging.set(false);
  clearSnapFeedback();
  app.stage?.invalidateFx();
}

/** What the transform overlay draws above the stage: the lifted pixels of a drag, or the scaled layer of Ctrl+T. */
export function floatingSprite(): FloatingSprite | null {
  if (drag?.kind === 'lift' && drag.moved) {
    const { lifted, at, offset } = drag;
    return { canvas: drag.sprite, rect: { x: at.x + offset.x, y: at.y + offset.y, w: lifted.width, h: lifted.height }, opacity: drag.opacity };
  }
  const s = liveSession();
  return s ? { canvas: s.sprite, rect: s.box, opacity: s.opacity } : null;
}

function startDrag(p: StagePointer): boolean {
  const doc = app.doc;
  if (!doc) return false;
  const selection = currentSelection(doc);
  const active = doc.active;
  if (selection && coverage(selection, p.ix, p.iy) > 0 && active?.kind === 'raster' && !active.generator) {
    const lift = prepareLift(active, selection, p);
    if (lift) {
      drag = lift;
      return true;
    }
  }
  const layer = layerAt(doc, p.ix, p.iy) ?? active;
  if (!layer) return false;
  if (layer.id !== doc.activeId) {
    doc.setActive(layer.id);
    sfx.play('tick');
  }
  const bounds = layerBounds(doc, layer) ?? { x: layer.x, y: layer.y, w: layer.image.width, h: layer.image.height };
  dragSerial += 1;
  drag = { kind: 'layer', layerId: layer.id, start: p, origin: { x: layer.x, y: layer.y }, bounds, key: `move-${dragSerial}`, moved: false };
  return true;
}

function moveDrag(p: StagePointer): void {
  const doc = app.doc;
  const current = drag;
  if (!doc || !current) return;
  if (!current.moved) {
    if (!leftSlop(current.start, p)) return;
    current.moved = true;
    stageDragging.set(true);
    if (current.kind === 'lift') doc.setPreview(current.preview);
  }
  const dx = Math.round(p.ix - current.start.ix);
  const dy = Math.round(p.iy - current.start.iy);
  if (current.kind === 'lift') {
    const box = { x: current.at.x + dx, y: current.at.y + dy, w: current.lifted.width, h: current.lifted.height };
    const snap = snapBoxLive(box, p.ctrl);
    current.offset = { x: dx + Math.round(snap.dx), y: dy + Math.round(snap.dy) };
    app.stage?.invalidateFx();
    return;
  }
  const box = { ...current.bounds, x: current.bounds.x + dx, y: current.bounds.y + dy };
  const snap = snapBoxLive(box, p.ctrl);
  doc.setLayerProps(current.layerId, { x: current.origin.x + dx + Math.round(snap.dx), y: current.origin.y + dy + Math.round(snap.dy) }, current.key);
}

function endDrag(): void {
  const doc = app.doc;
  const current = drag;
  drag = null;
  clearSnapFeedback();
  stageDragging.set(false);
  if (!current) return;
  if (current.kind === 'layer') {
    if (current.moved) sfx.play('tick');
    return;
  }
  if (doc && doc.preview === current.preview) doc.setPreview(null);
  releaseSprite(current.sprite);
  app.stage?.invalidateFx();
  if (!doc || !current.moved || (current.offset.x === 0 && current.offset.y === 0)) return;
  const source = doc.layer(current.layerId);
  if (!source) return;
  const { rect, before, after, lifted, at, offset } = current;
  doc.batch('select.history.lift', () => {
    doc.commitPatch(source.id, { rect, before, after }, 'history.paint');
    const layer = createRasterLayer(t('select.layer.liftName'), lifted, at.x + offset.x, at.y + offset.y);
    doc.addLayer({ ...layer, opacity: source.opacity });
    doc.setSelection(null);
  });
  sfx.play('layer');
}

const ARROWS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function nudge(e: KeyboardEvent): boolean {
  const dir = ARROWS[e.key];
  const doc = app.doc;
  if (!dir || !doc || e.ctrlKey || e.metaKey || e.altKey) return false;
  const step = e.shiftKey ? TUNING.select.nudge.big : TUNING.select.nudge.small;
  const s = liveSession();
  if (s) {
    if (!s.busy) s.box = { ...s.box, x: Math.round(s.box.x) + dir.x * step, y: Math.round(s.box.y) + dir.y * step };
    app.stage?.invalidateFx();
    sfx.play('tick');
    return true;
  }
  const layer = doc.active;
  if (!layer) {
    sfx.play('cancel');
    return true;
  }
  if (drag) return true;
  doc.setLayerProps(layer.id, { x: layer.x + dir.x * step, y: layer.y + dir.y * step }, 'nudge');
  sfx.play('tick');
  return true;
}

const MOVE_HINTS: readonly Hint[] = [
  { keys: 'Drag', text: 'select.hint.move' },
  { keys: 'Ctrl+Drag', text: 'select.hint.noSnap' },
  { keys: 'ArrowLeft ArrowRight ArrowUp ArrowDown', text: 'select.hint.nudge' },
  { keys: 'Shift+ArrowLeft ArrowRight ArrowUp ArrowDown', text: 'select.hint.nudgeBig' },
  { keys: keyLabels('layer.transform').join('+'), text: 'select.hint.transform' },
];

const SELECTION_HINT: Hint = { keys: 'Drag', text: 'select.hint.lift' };

const TRANSFORM_HINTS: readonly Hint[] = [
  { keys: 'Drag', text: 'select.hint.scale' },
  { keys: 'Shift+Drag', text: 'select.hint.free' },
  { keys: 'Enter', text: 'select.hint.apply' },
  { keys: 'Esc', text: 'select.hint.cancel' },
];

/** V: a press picks the top layer with a pixel under the pointer and drags it; inside a selection, it lifts the pixels. */
export const moveTool: ToolController = {
  id: 'move',
  get hints() {
    if (transformView.current) return TRANSFORM_HINTS;
    return app.doc?.selection ? [MOVE_HINTS[0], SELECTION_HINT, ...MOVE_HINTS.slice(1)] : MOVE_HINTS;
  },
  cursor(p) {
    if (p && liveSession()) {
      const hit = hitBox(p);
      return hit ? HANDLE_CURSORS[hit] : 'default';
    }
    return 'move';
  },
  down: (p) => startDrag(p),
  move: (p) => moveDrag(p),
  up: () => endDrag(),
  key(e) {
    if (liveSession()) {
      if (e.key === 'Enter') {
        void applyTransform();
        return true;
      }
      if (e.key === 'Escape') {
        cancelTransform();
        return true;
      }
    }
    return nudge(e);
  },
  deactivate() {
    cancelLift();
    if (drag) endDrag();
    if (liveSession()) void applyTransform();
  },
};
