import type { Rect } from '../core/types.ts';
import * as sfx from './sfx.ts';
import { snapBox, snapPoint, snapTargets, type SnapTarget } from './snapping.ts';
import { app } from './state.svelte.ts';
import { TUNING } from './tuning/index.ts';

/** Keeps only the targets that it accepts. */
export type SnapFilter = (target: SnapTarget) => boolean;

/** What the snap-flash overlay draws: the hits now, and the last hits after the drag ended (they fade out). */
export interface SnapFlashState {
  readonly hits: readonly SnapTarget[];
  /** performance.now() of the last new hit; -1 = never. */
  readonly hitAt: number;
  readonly released: readonly SnapTarget[];
  /** performance.now() of the end of the drag; -1 = nothing fades. */
  readonly releasedAt: number;
}

let hits: readonly SnapTarget[] = [];
let hitKey = '';
let hitAt = -1;
let released: readonly SnapTarget[] = [];
let releasedAt = -1;

function keyOf(list: readonly SnapTarget[]): string {
  return list
    .map((target) => `${target.axis}:${target.kind}:${target.pos}`)
    .sort()
    .join('|');
}

/** The snap distance in document px: a fixed distance on screen at each zoom. */
export function snapThreshold(): number {
  return TUNING.geometry.snap.thresholdPx / Math.max(app.zoom, 1e-6);
}

/**
 * The targets that a drag can snap to now, or null when snap is off (the view switch, or `bypass` when Ctrl is held).
 * Guides count only while they show; grid lines only while the grid shows.
 */
export function liveSnapTargets(bypass = false, filter?: SnapFilter): SnapTarget[] | null {
  const doc = app.doc;
  if (bypass || !doc || !app.view.snap) return null;
  const showGuides = app.view.guides;
  return snapTargets(doc, app.view.grid).filter((target) => (showGuides || target.kind !== 'guide') && (!filter || filter(target)));
}

/** Records the hits of the drag now: a new set flashes and plays 'snap'; an empty set ends the steady lines. */
export function showSnapHits(next: readonly SnapTarget[]): void {
  const key = keyOf(next);
  if (key === hitKey) return;
  const now = performance.now();
  if (next.length === 0) {
    released = hits;
    releasedAt = now;
  } else {
    sfx.play('snap');
    hitAt = now;
    released = [];
    releasedAt = -1;
  }
  hits = next;
  hitKey = key;
  app.stage?.invalidateFx();
}

/** Snaps a box in document px to guides, grid, stage edges and stage center. `bypass` (Ctrl held) turns it off. */
export function snapBoxLive(box: Rect, bypass?: boolean): { dx: number; dy: number } {
  const targets = liveSnapTargets(bypass);
  if (!targets) {
    showSnapHits([]);
    return { dx: 0, dy: 0 };
  }
  const result = snapBox(box, targets, snapThreshold());
  showSnapHits(result.hits);
  return { dx: result.dx, dy: result.dy };
}

/** Snaps one coordinate in document px. `filter` limits the targets, such as the stage edges and center only. */
export function snapValueLive(value: number, axis: 'x' | 'y', bypass?: boolean, filter?: SnapFilter): number {
  const targets = liveSnapTargets(bypass, filter);
  if (!targets) {
    showSnapHits([]);
    return value;
  }
  const result = snapPoint(value, axis, targets, snapThreshold());
  showSnapHits(result.hit ? [result.hit] : []);
  return result.value;
}

/** Call it at the end of a drag: the lines of the last hit fade out. */
export function clearSnapFeedback(): void {
  showSnapHits([]);
}

/** The state that the snap-flash overlay draws. */
export function snapFlashState(): SnapFlashState {
  return { hits, hitAt, released, releasedAt };
}
