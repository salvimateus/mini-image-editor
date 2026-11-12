import type { Guide } from '../../app/doc.svelte.ts';
import { formatDecimal } from '../../app/i18n/index.ts';
import * as sfx from '../../app/sfx.ts';
import { clearSnapFeedback, snapValueLive } from '../../app/snap-feedback.svelte.ts';
import { app } from '../../app/state.svelte.ts';
import { TUNING } from '../../app/tuning/index.ts';
import { snap, STAGE_COLORS, type StageHost, type StagePointer } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

/** A guide that follows the pointer: a new one from a ruler, or one that the Move tool drags. */
export interface GuideDraft {
  axis: 'x' | 'y';
  /** Document px. */
  pos: number;
  /** The pointer, in stage CSS px. */
  sx: number;
  sy: number;
  /** True when a release now deletes it (or does not create it). */
  remove: boolean;
}

const LABEL_FONT = `800 11px 'Nunito Variable', 'Nunito', system-ui, sans-serif`;

let rulerDraft: GuideDraft | null = null;
let moving: { id: number; origin: number; draft: GuideDraft } | null = null;

/** The guide of a ruler drag, or null at its end. */
export function setRulerGuide(draft: GuideDraft | null): void {
  rulerDraft = draft;
  app.stage?.invalidateFx();
}

/** A guide position in document px: whole pixels, unless a snap put it on a half pixel (a stage center). */
export function cleanGuidePos(pos: number): number {
  return Math.round(pos * 2) / 2;
}

/** True when a guide released here stays: the pointer is inside the view and the guide crosses the stage. */
export function guideKept(axis: 'x' | 'y', pos: number, sx: number, sy: number): boolean {
  const doc = app.doc;
  const stage = app.stage;
  if (!doc || !stage) return false;
  const { width, height } = stage.viewport;
  if (sx < 0 || sy < 0 || sx > width || sy > height) return false;
  return pos >= 0 && pos <= (axis === 'x' ? doc.width : doc.height);
}

function strokeGuide(fx: CanvasRenderingContext2D, host: StageHost, axis: 'x' | 'y', pos: number): void {
  const camera = host.camera;
  fx.beginPath();
  if (axis === 'x') {
    const x = snap(camera.panX + pos * camera.zoom, host.dpr);
    fx.moveTo(x, 0);
    fx.lineTo(x, camera.viewH);
  } else {
    const y = snap(camera.panY + pos * camera.zoom, host.dpr);
    fx.moveTo(0, y);
    fx.lineTo(camera.viewW, y);
  }
  fx.stroke();
}

function drawDraft(fx: CanvasRenderingContext2D, host: StageHost, draft: GuideDraft): void {
  fx.globalAlpha = draft.remove ? 0.4 : 1;
  fx.strokeStyle = draft.remove ? STAGE_COLORS.danger : STAGE_COLORS.guide;
  fx.lineWidth = 1 / host.dpr;
  fx.setLineDash(draft.remove ? [4, 4] : []);
  strokeGuide(fx, host, draft.axis, draft.pos);
  fx.setLineDash([]);
  fx.globalAlpha = 1;
  const value = Number.isInteger(draft.pos) ? String(draft.pos) : formatDecimal(draft.pos);
  const text = `${draft.axis === 'x' ? 'X' : 'Y'} ${value} px`;
  fx.font = LABEL_FONT;
  const width = Math.ceil(fx.measureText(text).width) + 14;
  const height = 20;
  const x = Math.max(4, Math.min(host.camera.viewW - width - 4, draft.sx + 14));
  const y = Math.max(4, Math.min(host.camera.viewH - height - 4, draft.sy + 14));
  fx.fillStyle = draft.remove ? STAGE_COLORS.danger : STAGE_COLORS.panel;
  fx.strokeStyle = STAGE_COLORS.panelEdge;
  fx.lineWidth = 1;
  fx.beginPath();
  fx.roundRect(x, y, width, height, height / 2);
  fx.fill();
  fx.stroke();
  fx.fillStyle = draft.remove ? STAGE_COLORS.black : STAGE_COLORS.white;
  fx.textAlign = 'center';
  fx.textBaseline = 'middle';
  fx.fillText(text, x + width / 2, y + height / 2 + 0.5);
}

/** The nearest guide within the hit distance (screen px), or null. */
function guideAt(p: StagePointer): Guide | null {
  const doc = app.doc;
  const stage = app.stage;
  if (!doc || !stage) return null;
  const reach: number = TUNING.geometry.guides.hitPx;
  let best: Guide | null = null;
  let bestDistance = reach;
  for (const guide of doc.guides) {
    const screen = guide.axis === 'x' ? stage.docToScreen(guide.pos, 0).x : stage.docToScreen(0, guide.pos).y;
    const distance = Math.abs((guide.axis === 'x' ? p.sx : p.sy) - screen);
    if (distance <= bestDistance) {
      best = guide;
      bestDistance = distance;
    }
  }
  return best;
}

function draftAt(axis: 'x' | 'y', origin: number, p: StagePointer): GuideDraft {
  const raw = axis === 'x' ? p.ix : p.iy;
  const snapped = snapValueLive(raw, axis, p.ctrl, (target) => !(target.kind === 'guide' && target.axis === axis && target.pos === origin));
  const pos = snapped === raw ? Math.round(raw) : cleanGuidePos(snapped);
  return { axis, pos, sx: p.sx, sy: p.sy, remove: !guideKept(axis, pos, p.sx, p.sy) };
}

/** The guides of the document, the guide of a ruler drag, and the drag of a guide with the Move tool. */
export const guidesOverlay: SceneOverlay = {
  z: 40,
  drawFx(fx, host) {
    const doc = app.doc;
    if (!doc) return false;
    if (app.view.guides) {
      fx.strokeStyle = STAGE_COLORS.guide;
      fx.lineWidth = 1 / host.dpr;
      for (const guide of doc.guides) {
        if (moving && moving.id === guide.id) continue;
        strokeGuide(fx, host, guide.axis, guide.pos);
      }
    }
    const draft = moving?.draft ?? rulerDraft;
    if (draft) drawDraft(fx, host, draft);
    return false;
  },
  pointerDown(p) {
    if (app.tool !== 'move' || !app.view.guides || p.button !== 0) return false;
    const guide = guideAt(p);
    if (!guide) return false;
    moving = { id: guide.id, origin: guide.pos, draft: { axis: guide.axis, pos: guide.pos, sx: p.sx, sy: p.sy, remove: false } };
    sfx.play('tick');
    return true;
  },
  pointerMove(p) {
    if (!moving) return;
    moving.draft = draftAt(moving.draft.axis, moving.origin, p);
    app.stage?.invalidateFx();
  },
  pointerUp(p) {
    const doc = app.doc;
    const done = moving;
    moving = null;
    clearSnapFeedback();
    if (!doc || !done) return;
    const draft = { ...done.draft, remove: !guideKept(done.draft.axis, done.draft.pos, p.sx, p.sy) };
    if (draft.remove) {
      doc.setGuides(
        doc.guides.filter((guide) => guide.id !== done.id),
        'geometry.history.guideDelete',
      );
      sfx.play('delete');
    } else if (draft.pos !== done.origin) {
      doc.setGuides(
        doc.guides.map((guide) => (guide.id === done.id ? { ...guide, pos: draft.pos } : guide)),
        'geometry.history.guideMove',
      );
      sfx.play('tick');
    }
    app.stage?.invalidateFx();
  },
};
