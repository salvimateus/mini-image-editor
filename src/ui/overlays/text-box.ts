import { textSession } from '../../app/fonts/text-session.svelte.ts';
import type { TextLayer } from '../../app/layers.ts';
import * as sfx from '../../app/sfx.ts';
import { clearSnapFeedback, snapValueLive } from '../../app/snap-feedback.svelte.ts';
import { app } from '../../app/state.svelte.ts';
import { areaWidth, textBox } from '../../app/text-render.ts';
import { textCreateBox } from '../../app/tools/text.ts';
import { TUNING } from '../../app/tuning/index.ts';
import type { Rect } from '../../core/types.ts';
import type { Camera } from '../camera.ts';
import { snap, snapEdge, STAGE_COLORS, type StagePointer } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

type Side = 'left' | 'right';

/** A drag of a side handle: the box sides at the press, in document px. */
interface HandleDrag {
  id: number;
  side: Side;
  left: number;
  right: number;
  top: number;
  coalesce: string;
}

let drag: HandleDrag | null = null;
let dragSerial = 0;

/** The active area text, when its box shows: the Text or the Move tool, and no new text in progress. */
function activeArea(): TextLayer | null {
  const doc = app.doc;
  if (!doc || (app.tool !== 'text' && app.tool !== 'move')) return null;
  if (textSession.draft && textSession.draft.session.doc === doc) return null;
  const layer = doc.active;
  return layer && layer.kind === 'text' && layer.visible && areaWidth(layer.spec) !== null ? layer : null;
}

/** The box of a new area text that has no letters yet. */
function draftBox(): Rect | null {
  const draft = textSession.draft;
  if (!draft || draft.session.doc !== app.doc) return null;
  const width = areaWidth(draft.spec);
  if (width === null) return null;
  return { x: draft.anchor.x, y: draft.anchor.y, w: width, h: draft.spec.size * draft.spec.lineHeight };
}

function screenBox(camera: Camera, box: Rect, dpr: number): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: snap(camera.panX + box.x * camera.zoom, dpr),
    y0: snap(camera.panY + box.y * camera.zoom, dpr),
    x1: snap(camera.panX + (box.x + box.w) * camera.zoom, dpr),
    y1: snap(camera.panY + (box.y + box.h) * camera.zoom, dpr),
  };
}

function outline(fx: CanvasRenderingContext2D, camera: Camera, box: Rect, dpr: number, dashed: boolean): { x0: number; y0: number; x1: number; y1: number } {
  const s = screenBox(camera, box, dpr);
  fx.lineWidth = 1;
  fx.setLineDash(dashed ? [5, 4] : []);
  fx.strokeStyle = STAGE_COLORS.black;
  fx.strokeRect(s.x0 + 1, s.y0 + 1, s.x1 - s.x0, s.y1 - s.y0);
  fx.strokeStyle = STAGE_COLORS.accent;
  fx.strokeRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
  fx.setLineDash([]);
  return s;
}

/** The screen center of each side handle of a box. */
function handleCenters(camera: Camera, box: Rect): Record<Side, { x: number; y: number }> {
  const y = camera.panY + (box.y + box.h / 2) * camera.zoom;
  return {
    left: { x: camera.panX + box.x * camera.zoom, y },
    right: { x: camera.panX + (box.x + box.w) * camera.zoom, y },
  };
}

function drawHandles(fx: CanvasRenderingContext2D, camera: Camera, box: Rect, dpr: number): void {
  const { widthPx, heightPx } = TUNING.text.boxHandle;
  const centers = handleCenters(camera, box);
  for (const side of ['left', 'right'] as const) {
    const active = drag?.side === side;
    const hx = snapEdge(centers[side].x - widthPx / 2, dpr);
    const hy = snapEdge(centers[side].y - heightPx / 2, dpr);
    fx.fillStyle = active ? STAGE_COLORS.accent : STAGE_COLORS.handle;
    fx.beginPath();
    fx.roundRect(hx, hy, widthPx, heightPx, widthPx / 2);
    fx.fill();
    fx.strokeStyle = STAGE_COLORS.handleEdge;
    fx.lineWidth = 2;
    fx.stroke();
  }
}

/** The side handle of the active area text under the pointer, or null. */
export function textBoxHandleAt(p: StagePointer): Side | null {
  const layer = activeArea();
  const camera = app.stage?.camera;
  if (!layer || !camera) return null;
  const { heightPx, hitPx } = TUNING.text.boxHandle;
  const centers = handleCenters(camera, textBox(layer));
  for (const side of ['right', 'left'] as const) {
    const c = centers[side];
    if (Math.abs(p.sx - c.x) <= hitPx && Math.abs(p.sy - c.y) <= heightPx / 2 + hitPx / 2) return side;
  }
  return null;
}

/**
 * The wrap box of area text: the box that a drag of the Text tool marks, the box of a new area text with no letters,
 * and the box of the active area text with two side handles that change its width.
 */
export const textBoxOverlay: SceneOverlay = {
  z: 76,
  drawFx(fx, host) {
    const camera = host.camera;
    const making = app.tool === 'text' ? textCreateBox() : null;
    if (making) {
      outline(fx, camera, making, host.dpr, true);
      return false;
    }
    const draft = draftBox();
    if (draft) {
      outline(fx, camera, draft, host.dpr, true);
      return false;
    }
    const layer = activeArea();
    if (!layer) return false;
    const box = textBox(layer);
    outline(fx, camera, box, host.dpr, false);
    drawHandles(fx, camera, box, host.dpr);
    return false;
  },
  pointerDown(p) {
    if (p.button !== 0) return false;
    const side = textBoxHandleAt(p);
    const layer = activeArea();
    if (!side || !layer) return false;
    const box = textBox(layer);
    dragSerial += 1;
    drag = { id: layer.id, side, left: box.x, right: box.x + box.w, top: box.y, coalesce: `box-${dragSerial}` };
    sfx.play('tick');
    return true;
  },
  pointerMove(p) {
    const current = drag;
    const doc = app.doc;
    if (!current || !doc || doc.activeId !== current.id) return;
    const min = TUNING.text.ranges.boxWidth.min;
    const edge = Math.round(snapValueLive(p.ix, 'x', p.ctrl));
    if (current.side === 'right') {
      textSession.update({ boxWidth: Math.max(min, edge - current.left) }, current.coalesce);
    } else {
      const left = Math.min(edge, Math.round(current.right) - min);
      textSession.update({ boxWidth: Math.round(current.right) - left }, current.coalesce, { x: left, y: Math.round(current.top) });
    }
    app.stage?.invalidateFx();
  },
  pointerUp() {
    if (!drag) return;
    drag = null;
    clearSnapFeedback();
    sfx.play('tick');
    app.stage?.invalidateFx();
  },
};
