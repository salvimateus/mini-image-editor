import { stageSizeProblem } from '../../app/actions/geometry.ts';
import { app } from '../../app/state.svelte.ts';
import { cropFlashAt, cropSession } from '../../app/tools/crop.ts';
import { TUNING } from '../../app/tuning/index.ts';
import type { Rect } from '../../core/types.ts';
import { checkerPattern, contentRect, easeOutCubic, progress, snap, snapEdge, STAGE_COLORS, type StageHost } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

const LABEL_FONT = `800 11px 'Nunito Variable', 'Nunito', system-ui, sans-serif`;

let handleSprite: { canvas: HTMLCanvasElement; dpr: number } | null = null;

/** One crop handle, drawn once for each device pixel ratio and then copied 8 times a frame. */
function handleImage(dpr: number): HTMLCanvasElement | null {
  if (handleSprite && handleSprite.dpr === dpr) return handleSprite.canvas;
  const side = TUNING.geometry.crop.handlePx;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.ceil((side + 2) * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = STAGE_COLORS.handleEdge;
  ctx.fillRect(0, 0, side + 2, side + 2);
  ctx.fillStyle = STAGE_COLORS.handle;
  ctx.fillRect(1.5, 1.5, side - 1, side - 1);
  handleSprite = { canvas, dpr };
  return canvas;
}

function screenBox(host: StageHost, box: Rect): Rect {
  const camera = host.camera;
  const a = camera.imageToScreen(box.x, box.y);
  const b = camera.imageToScreen(box.x + box.w, box.y + box.h);
  const dpr = host.dpr;
  const x = snapEdge(a.x, dpr);
  const y = snapEdge(a.y, dpr);
  return { x, y, w: snapEdge(b.x, dpr) - x, h: snapEdge(b.y, dpr) - y };
}

/** The part of the box outside the stage shows the fill of the new area: the checkerboard or the color. */
function drawNewArea(fx: CanvasRenderingContext2D, r: Rect, stage: Rect): void {
  const fill = cropSession.fill;
  fx.save();
  fx.beginPath();
  fx.rect(r.x, r.y, r.w, r.h);
  fx.clip();
  const area = new Path2D();
  area.rect(r.x, r.y, r.w, r.h);
  area.rect(stage.x, stage.y, stage.w, stage.h);
  if (fill === 'transparent') {
    const pattern = checkerPattern(fx);
    if (typeof pattern !== 'string') pattern.setTransform(new DOMMatrix([1, 0, 0, 1, stage.x, stage.y]));
    fx.fillStyle = pattern;
  } else {
    const color = fill === 'fg' ? app.fg : app.bg;
    fx.fillStyle = `rgb(${color.r} ${color.g} ${color.b})`;
  }
  fx.fill(area, 'evenodd');
  fx.restore();
}

function drawLabel(fx: CanvasRenderingContext2D, host: StageHost, r: Rect, w: number, h: number): void {
  const text = `${w} × ${h} px`;
  const invalid = stageSizeProblem(w, h) !== null;
  fx.font = LABEL_FONT;
  const height = TUNING.geometry.crop.labelPx;
  const width = Math.ceil(fx.measureText(text).width) + 16;
  const gap = TUNING.geometry.crop.handlePx;
  const viewH = host.camera.viewH;
  let y = r.y + r.h + gap;
  if (y + height > viewH - 4) y = r.y - gap - height;
  if (y < 4) y = Math.min(viewH - height - 4, r.y + r.h - height - gap);
  const x = Math.max(4, Math.min(host.camera.viewW - width - 4, r.x + r.w / 2 - width / 2));
  fx.fillStyle = invalid ? STAGE_COLORS.danger : STAGE_COLORS.panel;
  fx.strokeStyle = STAGE_COLORS.panelEdge;
  fx.lineWidth = 1;
  fx.beginPath();
  fx.roundRect(x, y, width, height, height / 2);
  fx.fill();
  fx.stroke();
  fx.fillStyle = invalid ? STAGE_COLORS.black : STAGE_COLORS.white;
  fx.textAlign = 'center';
  fx.textBaseline = 'middle';
  fx.fillText(text, x + width / 2, y + height / 2 + 0.5);
}

function drawBox(fx: CanvasRenderingContext2D, host: StageHost, box: Rect): void {
  const camera = host.camera;
  const dpr = host.dpr;
  const stage = contentRect(camera);
  const r = screenBox(host, box);
  drawNewArea(fx, r, stage);

  const shade = new Path2D();
  shade.rect(0, 0, camera.viewW, camera.viewH);
  shade.rect(r.x, r.y, r.w, r.h);
  fx.fillStyle = STAGE_COLORS.shade;
  fx.fill(shade, 'evenodd');

  // Rule of thirds.
  fx.beginPath();
  for (const k of [1, 2]) {
    const x = snap(r.x + (r.w * k) / 3, dpr);
    const y = snap(r.y + (r.h * k) / 3, dpr);
    fx.moveTo(x, r.y);
    fx.lineTo(x, r.y + r.h);
    fx.moveTo(r.x, y);
    fx.lineTo(r.x + r.w, y);
  }
  fx.strokeStyle = STAGE_COLORS.grid;
  fx.lineWidth = 1 / dpr;
  fx.stroke();

  const half = 0.5 / dpr;
  fx.lineWidth = 1 / dpr;
  fx.strokeStyle = STAGE_COLORS.black;
  fx.strokeRect(r.x - half * 3, r.y - half * 3, r.w + half * 6, r.h + half * 6);
  fx.strokeStyle = STAGE_COLORS.white;
  fx.strokeRect(r.x - half, r.y - half, r.w + half * 2, r.h + half * 2);

  const sprite = handleImage(dpr);
  if (sprite) {
    const side = TUNING.geometry.crop.handlePx + 2;
    const xs = [r.x, r.x + r.w / 2, r.x + r.w];
    const ys = [r.y, r.y + r.h / 2, r.y + r.h];
    for (let iy = 0; iy < 3; iy++) {
      for (let ix = 0; ix < 3; ix++) {
        if (ix === 1 && iy === 1) continue;
        fx.drawImage(sprite, snapEdge(xs[ix] - side / 2, dpr), snapEdge(ys[iy] - side / 2, dpr), side, side);
      }
    }
  }
  drawLabel(fx, host, r, box.w, box.h);
}

/** A short glow of the stage outline after a crop, a canvas size or an image size. */
function drawFlash(fx: CanvasRenderingContext2D, host: StageHost, now: number): boolean {
  const start = cropFlashAt();
  const duration = TUNING.geometry.crop.applyFlashMs;
  if (start < 0 || now - start > duration) return false;
  const k = progress(now, start, duration);
  const stage = contentRect(host.camera);
  const fade = host.reducedMotion ? 0.8 : 1 - easeOutCubic(k);
  const grow = host.reducedMotion ? 0 : easeOutCubic(k) * 10;
  fx.globalAlpha = fade;
  fx.strokeStyle = STAGE_COLORS.accent;
  fx.lineWidth = 3;
  fx.strokeRect(stage.x - grow, stage.y - grow, stage.w + grow * 2, stage.h + grow * 2);
  fx.globalAlpha = 1;
  return k < 1;
}

/** The crop box: a dim area outside it, the fill of the new area, thirds, 8 handles and the size label. */
export const cropOverlay: SceneOverlay = {
  z: 60,
  drawFx(fx, host, now) {
    const box = app.tool === 'crop' ? cropSession.box : null;
    if (box) drawBox(fx, host, box);
    return drawFlash(fx, host, now);
  },
};
