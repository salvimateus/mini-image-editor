import type { Point, RasterImage, Rect, ShapeSpec } from '../../core/types.ts';
import { sparkColors, type StagePointer } from '../../ui/stage-renderer.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import type { ShapeLayer } from '../layers.ts';
import { renderShapeLayer, shapeBox, shapeOrigin } from '../shape-render.ts';
import * as sfx from '../sfx.ts';
import { clearSnapFeedback, snapBoxLive, snapValueLive } from '../snap-feedback.svelte.ts';
import type { SnapTarget } from '../snapping.ts';
import { app } from '../state.svelte.ts';
import { TUNING } from '../tuning/index.ts';
import { layerSnapSource } from './move.ts';
import { restyleSteps } from './shape-settings.svelte.ts';

// The shared part of the Shapes and Steps tools and the shape handles: hit tests, the body drag, the handle drags and
// the live sprite of a shape that is not in the document yet.

/** True once the pointer left the click slop of the press. */
export function leftClick(start: StagePointer, p: StagePointer): boolean {
  return Math.hypot(p.sx - start.sx, p.sy - start.sy) >= TUNING.shapes.clickSlopPx;
}

/** A document point snapped to guides, grid, stage edges and stage center (a box of no size). */
export function snapPointLive(x: number, y: number, bypass: boolean): Point {
  const snap = snapBoxLive({ x, y, w: 0, h: 0 }, bypass);
  return { x: x + snap.dx, y: y + snap.dy };
}

/** A small burst at a screen point: a new shape pops in. */
export function popAt(sx: number, sy: number): void {
  const stage = app.stage;
  if (!stage) return;
  const burst = TUNING.shapes.createBurst;
  stage.particles.burst(sx, sy, { count: burst.count, colors: sparkColors(), speed: burst.speed, life: burst.life, size: burst.size });
  stage.host.invalidateFx();
}

/** The top-left corner (document px) that puts the spec origin of `spec` at `point`. */
export function placeAt(spec: ShapeSpec, point: Point): Point {
  const origin = shapeOrigin(spec);
  return { x: Math.round(point.x) - origin.x, y: Math.round(point.y) - origin.y };
}

/** The spec origin of the layer in document px: rect and ellipse top-left, arrow tail, step center. */
function originOf(layer: ShapeLayer): Point {
  const origin = shapeOrigin(layer.spec);
  return { x: layer.x + origin.x, y: layer.y + origin.y };
}

// ----- hit test -----

function hasPixelNear(image: RasterImage, lx: number, ly: number, reach: number): boolean {
  const { width, height, data } = image;
  const x0 = Math.max(0, lx - reach);
  const x1 = Math.min(width - 1, lx + reach);
  const y0 = Math.max(0, ly - reach);
  const y1 = Math.min(height - 1, ly + reach);
  const r2 = reach * reach;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - lx) ** 2 + (y - ly) ** 2 > r2) continue;
      if (data[(y * width + x) * 4 + 3] > 0) return true;
    }
  }
  return false;
}

/** The top visible layer with a pixel at the point, when it is a shape layer. A shape counts within a few screen px. */
export function shapeLayerAt(doc: EditorDoc, x: number, y: number): ShapeLayer | null {
  const px = Math.floor(x);
  const py = Math.floor(y);
  const { reachPx, maxReachPx } = TUNING.shapes.hit;
  const shapeReach = Math.min(maxReachPx, Math.ceil(reachPx / Math.max(app.zoom, 1e-6)));
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i];
    if (!layer.visible || layer.opacity <= 0) continue;
    const reach = layer.kind === 'shape' ? shapeReach : 0;
    const lx = px - layer.x;
    const ly = py - layer.y;
    if (lx < -reach || ly < -reach || lx >= layer.image.width + reach || ly >= layer.image.height + reach) continue;
    if (hasPixelNear(layer.image, lx, ly, reach)) return layer.kind === 'shape' ? layer : null;
  }
  return null;
}

// ----- body drag: a press on a shape selects it and moves it -----

interface BodyDrag { doc: EditorDoc; id: number; start: StagePointer; origin: Point; box: Rect; key: string; moved: boolean; layers: () => readonly SnapTarget[] }

let body: BodyDrag | null = null;
let serial = 0;

export function bodyDragging(): boolean {
  return body !== null;
}

export function beginBodyDrag(doc: EditorDoc, layer: ShapeLayer, p: StagePointer): void {
  if (doc.activeId !== layer.id) {
    doc.setActive(layer.id);
    sfx.play('tick');
  }
  serial += 1;
  body = { doc, id: layer.id, start: p, origin: { x: layer.x, y: layer.y }, box: shapeBox(layer), key: `shape-move-${serial}`, moved: false, layers: layerSnapSource(doc, layer.id) };
}

export function moveBodyDrag(p: StagePointer): void {
  const drag = body;
  if (!drag || app.doc !== drag.doc) return;
  if (!drag.moved) {
    if (!leftClick(drag.start, p)) return;
    drag.moved = true;
  }
  const dx = Math.round(p.ix - drag.start.ix);
  const dy = Math.round(p.iy - drag.start.iy);
  const snap = snapBoxLive({ ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy }, p.ctrl, drag.layers);
  drag.doc.setLayerProps(drag.id, { x: drag.origin.x + dx + Math.round(snap.dx), y: drag.origin.y + dy + Math.round(snap.dy) }, drag.key);
}

export function endBodyDrag(): void {
  const drag = body;
  body = null;
  if (!drag) return;
  clearSnapFeedback();
  if (drag.moved) sfx.play('tick');
}

// ----- handles -----

export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type ShapeHandle = BoxHandle | 'tail' | 'head';

const BOX_HANDLES: readonly BoxHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNER_HANDLES: readonly BoxHandle[] = ['nw', 'ne', 'se', 'sw'];

export const HANDLE_CURSORS: Record<ShapeHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  tail: 'grab',
  head: 'grab',
};

export interface HandleView {
  layer: ShapeLayer;
  /** The geometry box in document px; null for an arrow. */
  box: Rect | null;
  handles: { handle: ShapeHandle; x: number; y: number }[];
}

function boxPoint(box: Rect, handle: BoxHandle): Point {
  const x = handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.w : box.x + box.w / 2;
  const y = handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.h : box.y + box.h / 2;
  return { x, y };
}

function arrowEnds(layer: ShapeLayer): { tail: Point; head: Point } | null {
  if (layer.spec.kind !== 'arrow') return null;
  const tail = originOf(layer);
  return { tail, head: { x: tail.x + layer.spec.dx, y: tail.y + layer.spec.dy } };
}

let creating = false;

/** The Shapes and Steps tools hide the handles while they make a new shape. */
export function setCreating(value: boolean): void {
  creating = value;
}

/** The handles of the active shape layer, when the tool shows them (Move, Shapes, Steps). */
export function handleView(): HandleView | null {
  const doc = app.doc;
  if (!doc || creating) return null;
  if (app.tool !== 'move' && app.tool !== 'shape' && app.tool !== 'step') return null;
  const layer = doc.active;
  if (!layer || layer.kind !== 'shape' || !layer.visible) return null;
  const ends = arrowEnds(layer);
  if (ends) {
    return { layer, box: null, handles: [{ handle: 'tail', ...ends.tail }, { handle: 'head', ...ends.head }] };
  }
  const box = shapeBox(layer);
  const list = layer.spec.kind === 'step' ? CORNER_HANDLES : BOX_HANDLES;
  return { layer, box, handles: list.map((handle) => ({ handle, ...boxPoint(box, handle) })) };
}

/** The handle under the pointer, or null. */
export function handleAt(p: StagePointer): ShapeHandle | null {
  const view = handleView();
  const stage = app.stage;
  if (!view || !stage) return null;
  const reach = TUNING.shapes.handle.hitPx;
  // The last handle draws on top, so it wins.
  for (let i = view.handles.length - 1; i >= 0; i--) {
    const entry = view.handles[i];
    const screen = stage.docToScreen(entry.x, entry.y);
    if (Math.abs(p.sx - screen.x) <= reach && Math.abs(p.sy - screen.y) <= reach) return entry.handle;
  }
  return null;
}

interface HandleDrag {
  doc: EditorDoc;
  id: number;
  handle: ShapeHandle;
  start: StagePointer;
  spec: ShapeSpec;
  /** The dragged handle point at the press, in document px. */
  grab: Point;
  /** Rect and ellipse box, or the step box, at the press. */
  box: Rect | null;
  /** The arrow end that stays, at the press. */
  fixed: Point | null;
  key: string;
  pending: { spec: ShapeSpec; at: Point } | null;
  frame: number;
  pushed: boolean;
  lastPush: number;
  timer: ReturnType<typeof setInterval> | null;
}

let handleDrag: HandleDrag | null = null;

export function handleDragging(): boolean {
  return handleDrag !== null;
}

/** A press on a handle starts its drag; true = the press is taken. */
export function handlesDown(p: StagePointer): boolean {
  const doc = app.doc;
  const handle = handleAt(p);
  const view = handleView();
  if (!doc || !handle || !view) return false;
  const layer = view.layer;
  const point = view.handles.find((entry) => entry.handle === handle);
  if (!point) return false;
  const ends = arrowEnds(layer);
  serial += 1;
  handleDrag = {
    doc,
    id: layer.id,
    handle,
    start: p,
    spec: layer.spec,
    grab: { x: point.x, y: point.y },
    box: view.box,
    fixed: ends ? (handle === 'tail' ? ends.head : ends.tail) : null,
    key: `shape-handle-${serial}`,
    pending: null,
    frame: 0,
    pushed: false,
    lastPush: 0,
    timer: null,
  };
  sfx.play('tick');
  return true;
}

/** The rectangle after a drag of `handle` to (px, py); `keep` keeps the start proportions. */
function resizeBox(start: Rect, handle: BoxHandle, px: number, py: number, keep: boolean, min: number): Rect {
  const left = start.x;
  const top = start.y;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  let x0 = west ? Math.min(Math.round(px), right - min) : left;
  let x1 = east ? Math.max(Math.round(px), left + min) : right;
  let y0 = north ? Math.min(Math.round(py), bottom - min) : top;
  let y1 = south ? Math.max(Math.round(py), top + min) : bottom;
  if (keep && start.w > 0 && start.h > 0) {
    const horizontal = west || east;
    const vertical = north || south;
    let scale: number;
    if (horizontal && vertical) scale = Math.max((x1 - x0) / start.w, (y1 - y0) / start.h);
    else if (horizontal) scale = (x1 - x0) / start.w;
    else scale = (y1 - y0) / start.h;
    scale = Math.max(scale, min / Math.min(start.w, start.h));
    const w = Math.round(start.w * scale);
    const h = Math.round(start.h * scale);
    if (west) x0 = right - w;
    else if (east) x1 = left + w;
    else {
      x0 = Math.round(left + start.w / 2 - w / 2);
      x1 = x0 + w;
    }
    if (north) y0 = bottom - h;
    else if (south) y1 = top + h;
    else {
      y0 = Math.round(top + start.h / 2 - h / 2);
      y1 = y0 + h;
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The pointer held to steps of TUNING.shapes.angleStepDeg around `fixed`, with the same length. */
export function holdAngle(fixed: Point, point: Point): Point {
  const dx = point.x - fixed.x;
  const dy = point.y - fixed.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return point;
  const step = (TUNING.shapes.angleStepDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: fixed.x + Math.cos(angle) * length, y: fixed.y + Math.sin(angle) * length };
}

/** The spec and the position of the layer for the pointer now. */
function handleTarget(drag: HandleDrag, p: StagePointer): { spec: ShapeSpec; at: Point } | null {
  const spec = drag.spec;
  let px = drag.grab.x + (p.ix - drag.start.ix);
  let py = drag.grab.y + (p.iy - drag.start.iy);
  const handle = drag.handle;
  if (spec.kind === 'arrow') {
    const fixed = drag.fixed;
    if (!fixed) return null;
    let point: Point = { x: px, y: py };
    if (p.shift) point = holdAngle(fixed, point);
    else point = snapPointLive(point.x, point.y, p.ctrl);
    let dx = Math.round(point.x - fixed.x);
    let dy = Math.round(point.y - fixed.y);
    const min = TUNING.shapes.minArrowPx;
    const length = Math.hypot(dx, dy);
    if (length < min) {
      const k = length > 1e-6 ? min / length : 0;
      dx = k ? Math.round(dx * k) : min;
      dy = k ? Math.round(dy * k) : 0;
    }
    const tail = handle === 'tail' ? { x: fixed.x + dx, y: fixed.y + dy } : fixed;
    const head = handle === 'tail' ? fixed : { x: fixed.x + dx, y: fixed.y + dy };
    const next: ShapeSpec = { ...spec, dx: Math.round(head.x - tail.x), dy: Math.round(head.y - tail.y) };
    return { spec: next, at: placeAt(next, tail) };
  }
  const box = drag.box;
  if (!box || handle === 'tail' || handle === 'head') return null;
  const corner = handle.length === 2;
  if (corner) {
    const snapped = snapPointLive(px, py, p.ctrl);
    px = snapped.x;
    py = snapped.y;
  } else if (handle === 'e' || handle === 'w') {
    px = snapValueLive(px, 'x', p.ctrl);
  } else {
    py = snapValueLive(py, 'y', p.ctrl);
  }
  const min = TUNING.shapes.minPx;
  if (spec.kind === 'step') {
    // The opposite corner stays; the badge stays round.
    const fx = handle.includes('w') ? box.x + box.w : box.x;
    const fy = handle.includes('n') ? box.y + box.h : box.y;
    const size = Math.max(min, Math.round(Math.max(Math.abs(px - fx), Math.abs(py - fy))));
    const sx = handle.includes('w') ? -1 : 1;
    const sy = handle.includes('n') ? -1 : 1;
    const next: ShapeSpec = { ...spec, size };
    return { spec: next, at: placeAt(next, { x: fx + (sx * size) / 2, y: fy + (sy * size) / 2 }) };
  }
  const rect = resizeBox(box, handle, px, py, p.shift, min);
  const next: ShapeSpec = { ...spec, w: rect.w, h: rect.h };
  return { spec: next, at: placeAt(next, { x: rect.x, y: rect.y }) };
}

function pushTarget(drag: HandleDrag): void {
  const target = drag.pending;
  drag.pending = null;
  if (!target || app.doc !== drag.doc || !drag.doc.layer(drag.id)) return;
  try {
    const image = renderShapeLayer(target.spec);
    const spec = target.spec;
    if (spec.kind === 'step') {
      // All the steps share one size: the other steps follow, in the same undo step.
      drag.doc.batch(
        'history.shapeEdit',
        () => {
          drag.doc.setShapeSpec(drag.id, spec, image, undefined, target.at);
          restyleSteps(drag.doc, (other) => ({ ...other, size: spec.size }), drag.id);
        },
        drag.key,
      );
    } else {
      drag.doc.setShapeSpec(drag.id, spec, image, drag.key, target.at);
    }
    drag.pushed = true;
    drag.lastPush = performance.now();
  } catch (error) {
    app.fail(error);
  }
}

/** A held drag keeps its one undo step open: the same state goes in again before the coalesce time ends. */
function keepAlive(drag: HandleDrag): void {
  if (handleDrag !== drag || !drag.pushed || drag.pending) return;
  if (performance.now() - drag.lastPush < TUNING.shapes.keepAliveMs) return;
  const layer = drag.doc.layer(drag.id);
  if (!layer || layer.kind !== 'shape' || app.doc !== drag.doc) return;
  // A step drag records batches, so the keep-alive entry must have the same batch key to merge.
  if (layer.spec.kind === 'step') drag.doc.batch('history.shapeEdit', () => drag.doc.setShapeSpec(drag.id, layer.spec, layer.image), drag.key);
  else drag.doc.setShapeSpec(drag.id, layer.spec, layer.image, drag.key);
  drag.lastPush = performance.now();
}

export function handlesMove(p: StagePointer): void {
  const drag = handleDrag;
  if (!drag) return;
  const target = handleTarget(drag, p);
  if (!target) return;
  drag.pending = target;
  drag.timer ??= setInterval(() => keepAlive(drag), TUNING.shapes.keepAliveMs / 2);
  // One render for each frame: the newest pointer of the frame wins.
  if (!drag.frame) {
    drag.frame = requestAnimationFrame(() => {
      drag.frame = 0;
      pushTarget(drag);
    });
  }
}

export function handlesUp(): void {
  const drag = handleDrag;
  handleDrag = null;
  if (!drag) return;
  if (drag.frame) cancelAnimationFrame(drag.frame);
  if (drag.timer) clearInterval(drag.timer);
  pushTarget(drag);
  clearSnapFeedback();
  if (drag.pushed) sfx.play('resize');
  app.stage?.invalidateFx();
}

// ----- live sprite of a shape that is not in the document yet -----

export interface ShapeSprite { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number }

let draft: { spec: ShapeSpec; at: Point } | null = null;
let draftKey = '';
let sprite: { canvas: HTMLCanvasElement; key: string; w: number; h: number } | null = null;

/** The shape that a drag of the Shapes or Steps tool makes now, at `at` (the top-left corner of its image). */
export function setDraft(next: { spec: ShapeSpec; at: Point } | null): void {
  draft = next;
  draftKey = next ? JSON.stringify(next.spec) : '';
  if (!next && sprite) {
    sprite.canvas.width = 0;
    sprite.canvas.height = 0;
    sprite = null;
  }
  app.stage?.invalidateFx();
}

/** The real render of the draft, made at most once for each frame that draws it. Never read pixels back from it. */
export function draftSprite(): ShapeSprite | null {
  const current = draft;
  if (!current) return null;
  if (!sprite || sprite.key !== draftKey) {
    const image = renderShapeLayer(current.spec);
    const canvas = sprite?.canvas ?? document.createElement('canvas');
    canvas.width = Math.max(1, image.width);
    canvas.height = Math.max(1, image.height);
    const ctx = canvas.getContext('2d');
    ctx?.putImageData(new ImageData(image.data.slice() as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
    sprite = { canvas, key: draftKey, w: image.width, h: image.height };
  }
  return { canvas: sprite.canvas, x: current.at.x, y: current.at.y, w: sprite.w, h: sprite.h };
}

/** Ends every drag of this module, for a tool change. */
export function cancelShapeDrags(): void {
  if (handleDrag) handlesUp();
  if (body) endBodyDrag();
}
