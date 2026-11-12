import { get } from 'svelte/store';
import { polygonMask, type MaskOp } from '../../core/mask.ts';
import type { StagePointer } from '../../ui/stage-renderer.ts';
import { app } from '../state.svelte.ts';
import { TUNING } from '../tuning/index.ts';
import { applySelection, clickSelection, leftSlop, liveShape, modeHints, pressMode, selectSettings, setLiveShape } from './marquee-rect.ts';
import type { ToolController } from './types.ts';

let start: StagePointer | null = null;
let points: number[] = [];
let moved = false;
let op: MaskOp = 'replace';

/** Keeps a point only when it is far enough (screen px) from the last kept point. */
function addPoint(x: number, y: number): void {
  const n = points.length;
  if (n >= 2) {
    const step = TUNING.select.lassoStepPx / Math.max(app.zoom, 1e-6);
    if (Math.hypot(x - points[n - 2], y - points[n - 1]) < step) return;
  }
  points.push(x, y);
}

function reset(): void {
  start = null;
  points = [];
  moved = false;
}

/** A free path; on release the closed path becomes the selection. */
export const lassoTool: ToolController = {
  id: 'lasso',
  hints: [{ keys: 'Drag', text: 'select.hint.lasso' }, ...modeHints('Drag'), { keys: 'Click', text: 'select.hint.clear' }],
  cursor: () => 'crosshair',
  down(p) {
    if (!app.doc) return false;
    reset();
    start = p;
    op = pressMode(p);
    points.push(p.ix, p.iy);
    return true;
  },
  move(p) {
    if (!start) return;
    for (const sample of p.samples) addPoint(sample.x, sample.y);
    if (!moved && !leftSlop(start, p)) return;
    moved = true;
    setLiveShape({ kind: 'lasso', points, op });
  },
  up(p) {
    const doc = app.doc;
    if (start) addPoint(p.ix, p.iy);
    const path = points;
    const wasMoved = moved;
    const hadStart = start !== null;
    reset();
    setLiveShape(null);
    if (!doc || !hadStart) return;
    if (!wasMoved || path.length < 6) {
      clickSelection(doc, op);
      return;
    }
    const mask = polygonMask(doc.width, doc.height, Float32Array.from(path), get(selectSettings).feather);
    if (!mask.bounds) {
      clickSelection(doc, op);
      return;
    }
    applySelection(doc, mask, op);
  },
  deactivate() {
    reset();
    if (liveShape()) setLiveShape(null);
  },
};
