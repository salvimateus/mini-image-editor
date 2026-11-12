import { get, writable } from 'svelte/store';
import { combineMask, ellipseMask, rectMask, type Mask, type MaskOp } from '../../core/mask.ts';
import type { Point, Rect } from '../../core/types.ts';
import type { StagePointer } from '../../ui/stage-renderer.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import * as sfx from '../sfx.ts';
import { app } from '../state.svelte.ts';
import { readStored, writeStored } from '../storage.ts';
import { TUNING } from '../tuning/index.ts';
import type { Hint, ToolController, ToolId } from './types.ts';

// The shared part of the selection tools (marquees, lasso, wand) lives here: options, press mode, live shape, commit.

export interface SelectSettings { mode: MaskOp; feather: number; tolerance: number; contiguous: boolean }

export const SELECT_MODES: readonly MaskOp[] = ['replace', 'add', 'subtract', 'intersect'];

const STORE_KEY = 'select';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function cleanSettings(value: Partial<Record<keyof SelectSettings, unknown>>, base: SelectSettings): SelectSettings {
  const num = (input: unknown, fallback: number) => (typeof input === 'number' && Number.isFinite(input) ? input : fallback);
  return {
    mode: SELECT_MODES.includes(value.mode as MaskOp) ? (value.mode as MaskOp) : base.mode,
    feather: Math.round(clamp(num(value.feather, base.feather), 0, TUNING.select.featherMax)),
    tolerance: Math.round(clamp(num(value.tolerance, base.tolerance), 0, 255)),
    contiguous: typeof value.contiguous === 'boolean' ? value.contiguous : base.contiguous,
  };
}

function loadSettings(): SelectSettings {
  const base: SelectSettings = { ...TUNING.select.defaults };
  const text = readStored(STORE_KEY);
  if (!text) return base;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? cleanSettings(value as Record<string, unknown>, base) : base;
  } catch {
    return base;
  }
}

/** The options of the selection tools (options bar), stored. */
export const selectSettings = writable<SelectSettings>(loadSettings());

export function setSelectSettings(patch: Partial<SelectSettings>): void {
  const next = cleanSettings(patch, get(selectSettings));
  selectSettings.set(next);
  writeStored(STORE_KEY, JSON.stringify(next));
}

/** True while a selection drag or a move drag runs on the stage: the floating bars hide. */
export const stageDragging = writable(false);

/** Shift adds, Alt subtracts, Shift+Alt intersects; with no key, the mode of the options. */
export function pressMode(p: StagePointer): MaskOp {
  if (p.shift && p.alt) return 'intersect';
  if (p.shift) return 'add';
  if (p.alt) return 'subtract';
  return get(selectSettings).mode;
}

/** The selection of the document, or null when it has no area or does not fit the document size. */
export function currentSelection(doc: EditorDoc): Mask | null {
  const selection = doc.selection;
  if (!selection || !selection.bounds || selection.width !== doc.width || selection.height !== doc.height) return null;
  return selection;
}

/** Combines the new shape with the selection by `op` and stores it as one undo step. */
export function applySelection(doc: EditorDoc, shape: Mask, op: MaskOp): void {
  const next = combineMask(currentSelection(doc), shape, op);
  if (next === doc.selection) return;
  doc.setSelection(next);
  sfx.play('select');
  app.stage?.invalidateFx();
}

/** A click with no drag: in the plain mode it clears the selection. */
export function clickSelection(doc: EditorDoc, op: MaskOp): void {
  if (op !== 'replace' || !doc.selection) return;
  doc.setSelection(null, 'select.history.none');
  sfx.play('select');
  app.stage?.invalidateFx();
}

/** The shape of a selection drag in progress, in document px; the selection overlay draws it. */
export type LiveShape = { kind: 'rect' | 'ellipse'; rect: Rect; op: MaskOp } | { kind: 'lasso'; points: readonly number[]; op: MaskOp };

let live: LiveShape | null = null;

export function liveShape(): LiveShape | null {
  return live;
}

export function setLiveShape(shape: LiveShape | null): void {
  live = shape;
  if (get(stageDragging) !== (shape !== null)) stageDragging.set(shape !== null);
  app.stage?.invalidateFx();
}

/** The whole-pixel rect between two document points. */
export function cornerRect(a: Point, b: Point): Rect {
  const x0 = Math.round(Math.min(a.x, b.x));
  const y0 = Math.round(Math.min(a.y, b.y));
  const x1 = Math.round(Math.max(a.x, b.x));
  const y1 = Math.round(Math.max(a.y, b.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** True once the pointer left the click slop of the press. */
export function leftSlop(start: StagePointer, p: StagePointer): boolean {
  return Math.hypot(p.sx - start.sx, p.sy - start.sy) >= TUNING.select.clickSlopPx;
}

/** The hints that every selection tool shares, after its own first hint. */
export function modeHints(action: 'Drag' | 'Click'): Hint[] {
  return [
    { keys: `Shift+${action}`, text: 'select.hint.add' },
    { keys: `Alt+${action}`, text: 'select.hint.subtract' },
    { keys: `Shift+Alt+${action}`, text: 'select.hint.intersect' },
  ];
}

/** A rectangle or ellipse marquee: a drag makes the shape, a click with no drag clears the selection. */
export function createMarqueeTool(id: ToolId, kind: 'rect' | 'ellipse'): ToolController {
  let start: StagePointer | null = null;
  let moved = false;
  let op: MaskOp = 'replace';

  const shapeTo = (p: StagePointer): Rect => cornerRect({ x: start?.ix ?? p.ix, y: start?.iy ?? p.iy }, { x: p.ix, y: p.iy });

  return {
    id,
    hints: [
      { keys: 'Drag', text: kind === 'rect' ? 'select.hint.rect' : 'select.hint.ellipse' },
      ...modeHints('Drag'),
      { keys: 'Click', text: 'select.hint.clear' },
    ],
    cursor: () => 'crosshair',
    down(p) {
      if (!app.doc) return false;
      start = p;
      moved = false;
      op = pressMode(p);
      return true;
    },
    move(p) {
      if (!start) return;
      if (!moved && !leftSlop(start, p)) return;
      moved = true;
      setLiveShape({ kind, rect: shapeTo(p), op });
    },
    up(p) {
      const doc = app.doc;
      const rect = start ? shapeTo(p) : null;
      const wasMoved = moved;
      start = null;
      moved = false;
      setLiveShape(null);
      if (!doc || !rect) return;
      if (!wasMoved || rect.w < 1 || rect.h < 1) {
        clickSelection(doc, op);
        return;
      }
      const { feather } = get(selectSettings);
      const mask = kind === 'rect' ? rectMask(doc.width, doc.height, rect, feather) : ellipseMask(doc.width, doc.height, rect, feather);
      applySelection(doc, mask, op);
    },
    deactivate() {
      start = null;
      moved = false;
      if (live) setLiveShape(null);
    },
  };
}

export const marqueeRectTool: ToolController = createMarqueeTool('marquee-rect', 'rect');
