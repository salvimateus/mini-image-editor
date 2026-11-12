import { t } from '../../app/i18n/index.ts';
import { floatingSprite, handlePoints, transformBox, transformPointerDown, transformPointerMove, transformPointerUp, type FloatingSprite } from '../../app/tools/move.ts';
import { TUNING } from '../../app/tuning/index.ts';
import { intersectRect } from '../../core/raster.ts';
import type { Rect } from '../../core/types.ts';
import type { Camera } from '../camera.ts';
import { contentRect, snap, snapEdge, STAGE_COLORS } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

/** The sprite in its document rect, clipped to the stage; only the source part inside the view is drawn. */
function drawSprite(fx: CanvasRenderingContext2D, camera: Camera, sprite: FloatingSprite): void {
  const { canvas, rect } = sprite;
  if (canvas.width === 0 || rect.w <= 0 || rect.h <= 0) return;
  const a = camera.screenToImage(0, 0);
  const b = camera.screenToImage(camera.viewW, camera.viewH);
  const view: Rect = { x: Math.floor(a.x) - 1, y: Math.floor(a.y) - 1, w: Math.ceil(b.x - a.x) + 2, h: Math.ceil(b.y - a.y) + 2 };
  const part = intersectRect(rect, view);
  if (!part) return;
  const kx = canvas.width / rect.w;
  const ky = canvas.height / rect.h;
  const stage = contentRect(camera);
  fx.save();
  fx.beginPath();
  fx.rect(stage.x, stage.y, stage.w, stage.h);
  fx.clip();
  fx.globalAlpha = sprite.opacity;
  fx.imageSmoothingEnabled = camera.zoom < TUNING.stage.zoom.pixelatedFrom || kx !== 1 || ky !== 1;
  fx.imageSmoothingQuality = 'high';
  fx.drawImage(
    canvas,
    (part.x - rect.x) * kx,
    (part.y - rect.y) * ky,
    part.w * kx,
    part.h * ky,
    camera.panX + part.x * camera.zoom,
    camera.panY + part.y * camera.zoom,
    part.w * camera.zoom,
    part.h * camera.zoom,
  );
  fx.restore();
}

function drawBox(fx: CanvasRenderingContext2D, camera: Camera, box: Rect, dpr: number): void {
  const x0 = snap(camera.panX + box.x * camera.zoom, dpr);
  const y0 = snap(camera.panY + box.y * camera.zoom, dpr);
  const x1 = snap(camera.panX + (box.x + box.w) * camera.zoom, dpr);
  const y1 = snap(camera.panY + (box.y + box.h) * camera.zoom, dpr);
  fx.lineWidth = 1;
  fx.strokeStyle = STAGE_COLORS.black;
  fx.strokeRect(x0 + 1, y0 + 1, x1 - x0, y1 - y0);
  fx.strokeStyle = STAGE_COLORS.accent;
  fx.strokeRect(x0, y0, x1 - x0, y1 - y0);

  const side = TUNING.select.handle.sizePx;
  for (const point of handlePoints(box)) {
    const hx = snapEdge(camera.panX + point.x * camera.zoom - side / 2, dpr);
    const hy = snapEdge(camera.panY + point.y * camera.zoom - side / 2, dpr);
    fx.fillStyle = STAGE_COLORS.handle;
    fx.fillRect(hx, hy, side, side);
    fx.strokeStyle = STAGE_COLORS.handleEdge;
    fx.lineWidth = 2;
    fx.strokeRect(hx + 1, hy + 1, side - 2, side - 2);
  }

  const { gapPx, padPx, heightPx, font } = TUNING.select.sizeLabel;
  const text = t('chrome.status.size', { w: Math.max(1, Math.round(box.w)), h: Math.max(1, Math.round(box.h)) });
  fx.font = font;
  const width = fx.measureText(text).width + padPx * 2;
  const cx = (x0 + x1) / 2;
  const top = Math.min(y1 + gapPx, camera.viewH - heightPx - 4);
  const left = Math.max(4, Math.min(camera.viewW - width - 4, cx - width / 2));
  fx.fillStyle = STAGE_COLORS.panel;
  fx.strokeStyle = STAGE_COLORS.panelEdge;
  fx.lineWidth = 1;
  fx.beginPath();
  fx.roundRect(left, top, width, heightPx, heightPx / 2);
  fx.fill();
  fx.stroke();
  fx.fillStyle = STAGE_COLORS.white;
  fx.textAlign = 'center';
  fx.textBaseline = 'middle';
  fx.fillText(text, left + width / 2, top + heightPx / 2 + 0.5);
}

/** The pixels of a move or a transform above the stage, and the Ctrl+T box with its 8 handles. */
export const transformOverlay: SceneOverlay = {
  z: 70,
  drawFx(fx, host) {
    const camera = host.camera;
    const sprite = floatingSprite();
    if (sprite) drawSprite(fx, camera, sprite);
    const box = transformBox();
    if (box) drawBox(fx, camera, box, host.dpr);
    return false;
  },
  pointerDown: (p) => transformPointerDown(p),
  pointerMove: (p) => transformPointerMove(p),
  pointerUp: () => transformPointerUp(),
};
