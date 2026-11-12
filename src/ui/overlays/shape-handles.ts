import { draftSprite, handleView, handlesDown, handlesMove, handlesUp, type ShapeSprite } from '../../app/tools/shape-edit.ts';
import { TUNING } from '../../app/tuning/index.ts';
import type { Camera } from '../camera.ts';
import { contentRect, snap, snapEdge, STAGE_COLORS, stageColorsVersion } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

let squareSprite: { canvas: HTMLCanvasElement; dpr: number; version: number } | null = null;
let roundSprite: { canvas: HTMLCanvasElement; dpr: number; version: number } | null = null;

/** One handle, drawn once for each device pixel ratio and then copied for each handle. */
function handleImage(dpr: number, round: boolean): HTMLCanvasElement | null {
  const cached = round ? roundSprite : squareSprite;
  if (cached && cached.dpr === dpr && cached.version === stageColorsVersion()) return cached.canvas;
  const side = TUNING.shapes.handle.sizePx + 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.ceil(side * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  if (round) {
    ctx.beginPath();
    ctx.arc(side / 2, side / 2, side / 2, 0, Math.PI * 2);
    ctx.fillStyle = STAGE_COLORS.handleEdge;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(side / 2, side / 2, side / 2 - 1.5, 0, Math.PI * 2);
    ctx.fillStyle = STAGE_COLORS.handle;
    ctx.fill();
  } else {
    ctx.fillStyle = STAGE_COLORS.handleEdge;
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = STAGE_COLORS.handle;
    ctx.fillRect(1.5, 1.5, side - 3, side - 3);
  }
  const entry = { canvas, dpr, version: stageColorsVersion() };
  if (round) roundSprite = entry;
  else squareSprite = entry;
  return canvas;
}

/** The render of a shape that a drag makes now, in place, clipped to the stage like the layers. */
function drawDraft(fx: CanvasRenderingContext2D, camera: Camera, draft: ShapeSprite): void {
  const stage = contentRect(camera);
  fx.save();
  fx.beginPath();
  fx.rect(stage.x, stage.y, stage.w, stage.h);
  fx.clip();
  fx.imageSmoothingEnabled = camera.zoom < TUNING.stage.zoom.pixelatedFrom;
  fx.imageSmoothingQuality = 'high';
  const p = camera.imageToScreen(draft.x, draft.y);
  fx.drawImage(draft.canvas, p.x, p.y, draft.w * camera.zoom, draft.h * camera.zoom);
  fx.restore();
}

/** The handles of the active shape: a thin box (rectangle, ellipse, step) or a line (arrow), and the handle points. */
export const shapeHandlesOverlay: SceneOverlay = {
  z: 75,
  drawFx(fx, host) {
    const camera = host.camera;
    const dpr = host.dpr;
    const draft = draftSprite();
    if (draft) drawDraft(fx, camera, draft);
    const view = handleView();
    if (!view) return false;
    fx.lineWidth = 1;
    if (view.box) {
      const a = camera.imageToScreen(view.box.x, view.box.y);
      const b = camera.imageToScreen(view.box.x + view.box.w, view.box.y + view.box.h);
      const x0 = snap(a.x, dpr);
      const y0 = snap(a.y, dpr);
      const x1 = snap(b.x, dpr);
      const y1 = snap(b.y, dpr);
      fx.strokeStyle = STAGE_COLORS.black;
      fx.strokeRect(x0 + 1, y0 + 1, x1 - x0, y1 - y0);
      fx.strokeStyle = STAGE_COLORS.accent;
      fx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    } else if (view.handles.length === 2) {
      const a = camera.imageToScreen(view.handles[0].x, view.handles[0].y);
      const b = camera.imageToScreen(view.handles[1].x, view.handles[1].y);
      fx.setLineDash([4, 4]);
      fx.strokeStyle = STAGE_COLORS.accent;
      fx.beginPath();
      fx.moveTo(a.x, a.y);
      fx.lineTo(b.x, b.y);
      fx.stroke();
      fx.setLineDash([]);
    }
    const sprite = handleImage(dpr, view.box === null);
    if (!sprite) return false;
    const side = TUNING.shapes.handle.sizePx + 2;
    for (const entry of view.handles) {
      const p = camera.imageToScreen(entry.x, entry.y);
      fx.drawImage(sprite, snapEdge(p.x - side / 2, dpr), snapEdge(p.y - side / 2, dpr), side, side);
    }
    return false;
  },
  pointerDown: (p) => p.button === 0 && handlesDown(p),
  pointerMove: (p) => handlesMove(p),
  pointerUp: () => handlesUp(),
};
