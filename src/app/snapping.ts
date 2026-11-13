import type { Rect } from '../core/types.ts';
import type { EditorDoc, GridSpec } from './doc.svelte.ts';

export interface SnapTarget {
  axis: 'x' | 'y';
  pos: number;
  kind: 'stage-edge' | 'stage-center' | 'guide' | 'grid' | 'layer';
  /** A layer target only: the extent of its line on the other axis, in document px (a segment, not a full line). */
  span?: readonly [number, number];
}

/** On an equal distance, the earlier kind wins. */
const PRIORITY: Record<SnapTarget['kind'], number> = { guide: 0, layer: 1, 'stage-edge': 2, 'stage-center': 3, grid: 4 };

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

/** The left, center and right (x) and top, middle and bottom (y) of each box, with the extent of the box on the other axis. */
export function boxTargets(boxes: readonly Rect[]): SnapTarget[] {
  const targets: SnapTarget[] = [];
  for (const box of boxes) {
    const spanX: [number, number] = [box.x, box.x + box.w];
    const spanY: [number, number] = [box.y, box.y + box.h];
    for (const pos of [box.x, box.x + box.w / 2, box.x + box.w]) targets.push({ axis: 'x', pos, kind: 'layer', span: spanY });
    for (const pos of [box.y, box.y + box.h / 2, box.y + box.h]) targets.push({ axis: 'y', pos, kind: 'layer', span: spanX });
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

/**
 * One hit for each axis and position, so that one line shows: the kind of best priority wins. When it is a layer hit,
 * its span grows to cover `box` (the snapped box) and each layer at that position.
 */
export function mergeHits(hits: readonly SnapTarget[], box: Rect): SnapTarget[] {
  const merged: SnapTarget[] = [];
  for (const hit of hits) {
    const index = merged.findIndex((other) => other.axis === hit.axis && Math.abs(other.pos - hit.pos) <= EPSILON);
    if (index < 0) merged.push(hit);
    else {
      const other = merged[index];
      const winner = PRIORITY[hit.kind] < PRIORITY[other.kind] ? hit : other;
      merged[index] = winner.span && other.span && hit.span ? { ...winner, span: [Math.min(hit.span[0], other.span[0]), Math.max(hit.span[1], other.span[1])] } : winner;
    }
  }
  return merged.map((hit) => {
    if (!hit.span) return hit;
    const from = hit.axis === 'x' ? box.y : box.x;
    const to = hit.axis === 'x' ? box.y + box.h : box.x + box.w;
    return { ...hit, span: [Math.min(from, hit.span[0]), Math.max(to, hit.span[1])] };
  });
}
