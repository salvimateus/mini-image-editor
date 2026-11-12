import type { Rect } from '../core/types.ts';
import type { EditorDoc, GridSpec } from './doc.svelte.ts';

export interface SnapTarget { axis: 'x' | 'y'; pos: number; kind: 'stage-edge' | 'stage-center' | 'guide' | 'grid' }

/** On an equal distance, the earlier kind wins. */
const PRIORITY: Record<SnapTarget['kind'], number> = { guide: 0, 'stage-edge': 1, 'stage-center': 2, grid: 3 };

const EPSILON = 1e-6;

/** Grid line positions along one axis of the stage, inside it (the edges are stage targets). */
export function gridLines(grid: GridSpec, length: number, divisions: number): number[] {
  const lines: number[] = [];
  if (grid.mode === 'divisions') {
    const count = Math.max(1, Math.round(divisions));
    for (let i = 1; i < count; i++) lines.push((length * i) / count);
    return lines;
  }
  const spacing = grid.spacing;
  if (!(spacing > 0)) return lines;
  for (let pos = spacing; pos < length - EPSILON; pos += spacing) lines.push(pos);
  return lines;
}

/** The stage edges, the stage center, each guide and, with `useGrid`, each grid line. */
export function snapTargets(doc: EditorDoc, useGrid: boolean): SnapTarget[] {
  const { width, height } = doc;
  const targets: SnapTarget[] = [
    { axis: 'x', pos: 0, kind: 'stage-edge' },
    { axis: 'x', pos: width, kind: 'stage-edge' },
    { axis: 'y', pos: 0, kind: 'stage-edge' },
    { axis: 'y', pos: height, kind: 'stage-edge' },
    { axis: 'x', pos: width / 2, kind: 'stage-center' },
    { axis: 'y', pos: height / 2, kind: 'stage-center' },
  ];
  for (const guide of doc.guides) targets.push({ axis: guide.axis, pos: guide.pos, kind: 'guide' });
  if (useGrid) {
    for (const pos of gridLines(doc.grid, width, doc.grid.cols)) targets.push({ axis: 'x', pos, kind: 'grid' });
    for (const pos of gridLines(doc.grid, height, doc.grid.rows)) targets.push({ axis: 'y', pos, kind: 'grid' });
  }
  return targets;
}

/** The nearest target of the axis to any of the values, within the threshold. */
function nearest(values: readonly number[], axis: 'x' | 'y', targets: readonly SnapTarget[], threshold: number): { delta: number; target: SnapTarget } | null {
  let best: { delta: number; target: SnapTarget } | null = null;
  for (const target of targets) {
    if (target.axis !== axis) continue;
    for (const value of values) {
      const delta = target.pos - value;
      const distance = Math.abs(delta);
      if (distance > threshold) continue;
      if (!best) {
        best = { delta, target };
        continue;
      }
      const bestDistance = Math.abs(best.delta);
      if (distance < bestDistance - EPSILON || (Math.abs(distance - bestDistance) <= EPSILON && PRIORITY[target.kind] < PRIORITY[best.target.kind])) {
        best = { delta, target };
      }
    }
  }
  return best;
}

/** The targets that one of the values touches exactly. */
function touching(values: readonly number[], axis: 'x' | 'y', targets: readonly SnapTarget[]): SnapTarget[] {
  return targets.filter((target) => target.axis === axis && values.some((value) => Math.abs(target.pos - value) <= EPSILON));
}

/**
 * The move that snaps the left, center or right (and top, middle or bottom) of the box to the nearest target within
 * `threshold` (document px). `hits` holds every target that the moved box touches on a snapped axis.
 */
export function snapBox(box: Rect, targets: readonly SnapTarget[], threshold: number): { dx: number; dy: number; hits: SnapTarget[] } {
  const xs = [box.x, box.x + box.w / 2, box.x + box.w];
  const ys = [box.y, box.y + box.h / 2, box.y + box.h];
  const sx = nearest(xs, 'x', targets, threshold);
  const sy = nearest(ys, 'y', targets, threshold);
  const dx = sx ? sx.delta : 0;
  const dy = sy ? sy.delta : 0;
  const hits: SnapTarget[] = [];
  if (sx) hits.push(...touching(xs.map((value) => value + dx), 'x', targets));
  if (sy) hits.push(...touching(ys.map((value) => value + dy), 'y', targets));
  return { dx, dy, hits };
}

/** One coordinate snapped to the nearest target of its axis within `threshold` (document px). */
export function snapPoint(value: number, axis: 'x' | 'y', targets: readonly SnapTarget[], threshold: number): { value: number; hit: SnapTarget | null } {
  const best = nearest([value], axis, targets, threshold);
  return best ? { value: value + best.delta, hit: best.target } : { value, hit: null };
}
