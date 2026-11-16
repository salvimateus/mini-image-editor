import { TUNING } from '../../app/tuning/index.ts';
import { intersectRect } from '../../core/raster.ts';
import type { Rect } from '../../core/types.ts';
import type { Camera } from '../camera.ts';
import { contentRect } from '../stage-renderer.ts';

/** A canvas shown over the document: `rect` in document px; the canvas can be smaller than the rect. */
export interface StageSprite { canvas: HTMLCanvasElement; rect: Rect; opacity: number }

/** The sprite in its document rect, clipped to the stage; only the source part inside the view is drawn. */
export function drawSprite(fx: CanvasRenderingContext2D, camera: Camera, sprite: StageSprite): void {
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
