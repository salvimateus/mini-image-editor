import { fitRatio } from '../aspect.ts';
import { applyStageRect, stageFillColor, stageSizeProblem, type StageFill } from '../actions/geometry.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import { snapPoint, type SnapTarget } from '../snapping.ts';
import { clearSnapFeedback, liveSnapTargets, showSnapHits, snapBoxLive, snapThreshold } from '../snap-feedback.svelte.ts';
import * as sfx from '../sfx.ts';
import { app, type CropRequest } from '../state.svelte.ts';
import { TUNING } from '../tuning/index.ts';
import type { Rect } from '../../core/types.ts';
import type { StagePointer } from '../../ui/stage-renderer.ts';
import type { ToolController } from './types.ts';

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type CropMode = 'crop' | 'expand';
export type CropFill = Extract<StageFill, 'transparent' | 'fg' | 'bg'>;

/** The crop box of the open document, in document px. It can leave the stage, to grow it. */
interface Session {
  doc: EditorDoc;
  stageW: number;
  stageH: number;
  box: Rect;
  /** The locked ratio (width / height), or null for a free box. */
  ratio: { w: number; h: number } | null;
  mode: CropMode;
  fill: CropFill;
}

interface Drag {
  kind: 'move' | 'resize';
  /** -1 = the left (top) edge moves, 1 = the right (bottom) edge, 0 = none. */
  hx: -1 | 0 | 1;
  hy: -1 | 0 | 1;
  start: Rect;
  px: number;
  py: number;
  /** The ratio that the drag keeps (width / height), or null. */
  keep: number | null;
}

const HANDLES: readonly { id: CropHandle; hx: -1 | 0 | 1; hy: -1 | 0 | 1 }[] = [
  { id: 'nw', hx: -1, hy: -1 },
  { id: 'n', hx: 0, hy: -1 },
  { id: 'ne', hx: 1, hy: -1 },
  { id: 'e', hx: 1, hy: 0 },
  { id: 'se', hx: 1, hy: 1 },
  { id: 's', hx: 0, hy: 1 },
  { id: 'sw', hx: -1, hy: 1 },
  { id: 'w', hx: -1, hy: 0 },
];

const CURSORS: Record<CropHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

let session: Session | null = null;
let drag: Drag | null = null;
let applying = false;
let active = false;
/** The crop request that the session used last, so that the same request is not used twice. */
let usedRequest: CropRequest | null = null;
const listeners = new Set<() => void>();
/** Kept between sessions: the user picks them once. */
let lastFill: CropFill = 'transparent';
let lastMode: CropMode = 'crop';
/** performance.now() of the last stage change, for the flash of the new stage outline; -1 = none. */
let flashAt = -1;

function changed(): void {
  app.stage?.invalidateFx();
  for (const listener of [...listeners]) listener();
}

function fullBox(doc: EditorDoc): Rect {
  return { x: 0, y: 0, w: doc.width, h: doc.height };
}

function newSession(doc: EditorDoc, ratio: Session['ratio'], mode: CropMode): Session {
  const box = ratio ? fitRatio(doc.width, doc.height, ratio.w, ratio.h, mode) : fullBox(doc);
  return { doc, stageW: doc.width, stageH: doc.height, box, ratio, mode, fill: lastFill };
}

/** The session of the open document; a new document or a new stage size starts it again. */
function current(): Session | null {
  const doc = app.doc;
  if (!active || !doc) return null;
  if (!session || session.doc !== doc) {
    session = newSession(doc, null, lastMode);
  } else if (!drag && (session.stageW !== doc.width || session.stageH !== doc.height)) {
    session = newSession(doc, session.ratio, session.mode);
  }
  return session;
}

function roundBox(box: Rect): Rect {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const r = Math.round(box.x + box.w);
  const b = Math.round(box.y + box.h);
  return { x, y, w: Math.max(1, r - x), h: Math.max(1, b - y) };
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** The handle under the pointer (screen distance), 'inside' for a press inside the box, or null. */
function hitTest(p: StagePointer, box: Rect): CropHandle | 'inside' | null {
  const stage = app.stage;
  if (!stage) return null;
  const a = stage.docToScreen(box.x, box.y);
  const b = stage.docToScreen(box.x + box.w, box.y + box.h);
  const reach: number = TUNING.geometry.crop.hitPx;
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  let best: CropHandle | null = null;
  let bestDistance = reach;
  for (const handle of HANDLES) {
    const hx = handle.hx < 0 ? a.x : handle.hx > 0 ? b.x : cx;
    const hy = handle.hy < 0 ? a.y : handle.hy > 0 ? b.y : cy;
    const distance = Math.hypot(p.sx - hx, p.sy - hy);
    if (distance <= bestDistance) {
      best = handle.id;
      bestDistance = distance;
    }
  }
  if (best) return best;
  // An edge of a small box: the nearest edge handle, so a thin box can still grow.
  const nearX = p.sy >= a.y - reach && p.sy <= b.y + reach;
  const nearY = p.sx >= a.x - reach && p.sx <= b.x + reach;
  if (nearX && Math.abs(p.sx - a.x) <= reach / 2) return 'w';
  if (nearX && Math.abs(p.sx - b.x) <= reach / 2) return 'e';
  if (nearY && Math.abs(p.sy - a.y) <= reach / 2) return 'n';
  if (nearY && Math.abs(p.sy - b.y) <= reach / 2) return 's';
  if (p.sx > a.x && p.sx < b.x && p.sy > a.y && p.sy < b.y) return 'inside';
  return null;
}

/** One moving edge snapped to the targets, or the value as it is. */
function snapEdge(value: number, axis: 'x' | 'y', targets: readonly SnapTarget[] | null): { value: number; hit: SnapTarget | null } {
  if (!targets) return { value, hit: null };
  return snapPoint(value, axis, targets, snapThreshold());
}

/** The box of a resize drag: the anchor edges stay, the moving edges follow the pointer, snapped, with the kept ratio. */
function resizeBox(d: Drag, p: StagePointer): Rect {
  const s = d.start;
  const targets = liveSnapTargets(p.ctrl);
  const dx = p.ix - d.px;
  const dy = p.iy - d.py;
  const anchorX = d.hx < 0 ? s.x + s.w : s.x;
  const anchorY = d.hy < 0 ? s.y + s.h : s.y;
  let x = snapEdge((d.hx < 0 ? s.x : s.x + s.w) + dx, 'x', d.hx ? targets : null);
  let y = snapEdge((d.hy < 0 ? s.y : s.y + s.h) + dy, 'y', d.hy ? targets : null);
  let left = s.x;
  let right = s.x + s.w;
  let top = s.y;
  let bottom = s.y + s.h;
  const ratio = d.keep;
  if (ratio && d.hx && d.hy) {
    // A corner: the axis that makes the box larger leads, unless only the other axis snapped.
    const w = Math.abs(x.value - anchorX);
    const h = Math.abs(y.value - anchorY);
    const leadX = x.hit && !y.hit ? true : y.hit && !x.hit ? false : w / Math.max(h, 1e-6) >= ratio;
    if (leadX) {
      const sign = Math.sign(y.value - anchorY) || d.hy;
      y = { value: anchorY + (sign * w) / ratio, hit: null };
    } else {
      const sign = Math.sign(x.value - anchorX) || d.hx;
      x = { value: anchorX + sign * h * ratio, hit: null };
    }
  }
  if (d.hx) [left, right] = x.value < anchorX ? [x.value, anchorX] : [anchorX, x.value];
  if (d.hy) [top, bottom] = y.value < anchorY ? [y.value, anchorY] : [anchorY, y.value];
  if (ratio && d.hx && !d.hy) {
    const h = (right - left) / ratio;
    const cy = s.y + s.h / 2;
    top = cy - h / 2;
    bottom = cy + h / 2;
  } else if (ratio && d.hy && !d.hx) {
    const w = (bottom - top) * ratio;
    const cx = s.x + s.w / 2;
    left = cx - w / 2;
    right = cx + w / 2;
  }
  showSnapHits([x.hit, y.hit].filter((hit): hit is SnapTarget => hit !== null));
  return roundBox({ x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) });
}

function moveBox(d: Drag, p: StagePointer): Rect {
  const moved = { ...d.start, x: d.start.x + p.ix - d.px, y: d.start.y + p.iy - d.py };
  const snap = snapBoxLive(moved, p.ctrl);
  return roundBox({ ...moved, x: moved.x + snap.dx, y: moved.y + snap.dy });
}

function ratioValue(ratio: Session['ratio']): number | null {
  return ratio && ratio.w > 0 && ratio.h > 0 ? ratio.w / ratio.h : null;
}

/** The crop session as the options bar and the overlay see it. */
export const cropSession = {
  /** The box in document px, or null when the crop tool is not active. */
  get box(): Rect | null {
    return current()?.box ?? null;
  },
  get ratio(): { w: number; h: number } | null {
    return current()?.ratio ?? null;
  },
  get mode(): CropMode {
    return current()?.mode ?? lastMode;
  },
  get fill(): CropFill {
    return current()?.fill ?? lastFill;
  },
  get dragging(): boolean {
    return drag !== null;
  },
  get applying(): boolean {
    return applying;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Starts from the largest centered box of the requested ratio (a new request only). */
  useRequest(request: CropRequest | null): void {
    if (!request || request === usedRequest) return;
    const doc = app.doc;
    if (!active || !doc) return;
    usedRequest = request;
    lastMode = request.mode;
    session = newSession(doc, { w: request.ratioW, h: request.ratioH }, request.mode);
    changed();
  },

  /** New width and height from the fields; with a locked ratio the other side follows. The box keeps its center. */
  setSize(width: number | null, height: number | null): void {
    const s = current();
    if (!s) return;
    const ratio = ratioValue(s.ratio);
    let w = width ?? s.box.w;
    let h = height ?? s.box.h;
    if (ratio && width !== null && height === null) h = w / ratio;
    else if (ratio && height !== null && width === null) w = h * ratio;
    const cx = s.box.x + s.box.w / 2;
    const cy = s.box.y + s.box.h / 2;
    s.box = roundBox({ x: cx - w / 2, y: cy - h / 2, w: Math.max(1, w), h: Math.max(1, h) });
    changed();
  },

  /** Locks the ratio of the box now, or frees it. */
  toggleLock(): void {
    const s = current();
    if (!s) return;
    s.ratio = s.ratio ? null : { w: s.box.w, h: s.box.h };
    sfx.play('tick');
    changed();
  },

  /** "Cortar": the largest box of the ratio inside the stage; "Expandir": the smallest box around it. */
  setMode(mode: CropMode): void {
    const s = current();
    if (!s) return;
    lastMode = mode;
    s.mode = mode;
    const ratio = s.ratio ?? { w: s.box.w, h: s.box.h };
    s.box = fitRatio(s.doc.width, s.doc.height, ratio.w, ratio.h, mode);
    sfx.play('tick');
    changed();
  },

  setFill(fill: CropFill): void {
    lastFill = fill;
    const s = current();
    if (s) s.fill = fill;
    sfx.play('tick');
    changed();
  },

  /** The box back to the whole stage, with no ratio. */
  cancel(): void {
    const doc = app.doc;
    if (!active || !doc) return;
    drag = null;
    clearSnapFeedback();
    const wasFull = session && session.doc === doc && !session.ratio && sameRect(session.box, fullBox(doc));
    session = newSession(doc, null, lastMode);
    if (!wasFull) sfx.play('cancel');
    changed();
  },

  async apply(): Promise<void> {
    const s = current();
    if (!s || applying || drag) return;
    const doc = s.doc;
    const box = roundBox(s.box);
    if (sameRect(box, fullBox(doc))) {
      sfx.play('tick');
      return;
    }
    const problem = stageSizeProblem(box.w, box.h);
    if (problem) {
      sfx.play('error');
      app.toast(problem, 'error');
      return;
    }
    applying = true;
    changed();
    try {
      const done = await applyStageRect(doc, box, stageFillColor(s.fill), 'geometry.history.crop');
      if (done) {
        sfx.play('crop');
        flashAt = performance.now();
      }
    } catch (error) {
      app.fail(error);
    } finally {
      applying = false;
      if (session && session.doc === doc) session = newSession(doc, session.ratio, session.mode);
      changed();
    }
  },
};

export function cropFlashAt(): number {
  return flashAt;
}

/** Marks the stage outline to flash once, after a canvas size or an image size. */
export function flashStageOutline(): void {
  flashAt = performance.now();
  app.stage?.invalidateFx();
}

export const cropTool: ToolController = {
  id: 'crop',
  hints: [
    { keys: 'Drag', text: 'geometry.hint.cropDrag' },
    { keys: 'Shift+Drag', text: 'geometry.hint.cropRatio' },
    { keys: 'Ctrl+Drag', text: 'geometry.hint.noSnap' },
    { keys: 'Enter', text: 'geometry.hint.cropApply' },
    { keys: 'Esc', text: 'geometry.hint.cropCancel' },
  ],
  cursor(p) {
    const s = current();
    if (!p || !s) return 'crosshair';
    const hit = hitTest(p, s.box);
    if (hit === 'inside') return 'move';
    return hit ? CURSORS[hit] : 'crosshair';
  },
  down(p) {
    const s = current();
    if (!s || applying) return false;
    const hit = hitTest(p, s.box);
    const locked = ratioValue(s.ratio);
    if (hit === 'inside') {
      drag = { kind: 'move', hx: 0, hy: 0, start: { ...s.box }, px: p.ix, py: p.iy, keep: null };
      return true;
    }
    if (hit) {
      const handle = HANDLES.find((entry) => entry.id === hit);
      if (!handle) return false;
      const keep = locked ?? (p.shift && handle.hx && handle.hy ? s.box.w / s.box.h : null);
      drag = { kind: 'resize', hx: handle.hx, hy: handle.hy, start: { ...s.box }, px: p.ix, py: p.iy, keep };
      return true;
    }
    // A press outside the box draws a new box from that point.
    const x = Math.round(p.ix);
    const y = Math.round(p.iy);
    drag = { kind: 'resize', hx: 1, hy: 1, start: { x, y, w: 0, h: 0 }, px: x, py: y, keep: locked ?? (p.shift ? 1 : null) };
    return true;
  },
  move(p) {
    const s = current();
    if (!s || !drag) return;
    const next = drag.kind === 'move' ? moveBox(drag, p) : resizeBox(drag, p);
    if (sameRect(next, s.box)) return;
    s.box = next;
    changed();
  },
  up() {
    if (!drag) return;
    drag = null;
    clearSnapFeedback();
    changed();
    sfx.play('tick');
  },
  key(e) {
    if (!current()) return false;
    if (e.key === 'Enter') {
      e.preventDefault();
      void cropSession.apply();
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cropSession.cancel();
      return true;
    }
    return false;
  },
  activate() {
    active = true;
    session = null;
    drag = null;
    const request = app.cropRequest;
    if (request && request !== usedRequest) cropSession.useRequest(request);
    else changed();
  },
  deactivate() {
    // A tool change with no apply cancels the box.
    active = false;
    session = null;
    if (drag) clearSnapFeedback();
    drag = null;
    changed();
  },
};
