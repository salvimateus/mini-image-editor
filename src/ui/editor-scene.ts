import type { EditorDoc, LayerPreview } from '../app/doc.svelte.ts';
import type { Layer } from '../app/layers.ts';
import { TUNING } from '../app/tuning/index.ts';
import type { Rect } from '../core/types.ts';
import type { Camera } from './camera.ts';
import { LayerViews, type ImageView } from './layer-views.ts';
import { OVERLAYS } from './overlays/index.ts';
import { checkerPattern, contentRect, drawFrameEdge, drawFrameShadow, type Scene, type StageHost } from './stage-renderer.ts';

/** The document part of the view that the camera shows, in document px, grown by one pixel for the smoothing. */
interface VisibleDoc {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The stage of one document: the checkerboard, the visible layers clipped to the stage, the live preview of an
 * adjustment, and the overlays of the fx canvas. It draws only after a change of the document or the view.
 */
export class EditorScene implements Scene {
  readonly doc: EditorDoc;
  private readonly views: LayerViews;
  private host: StageHost | null = null;
  private stopViews: (() => void) | null = null;

  constructor(doc: EditorDoc) {
    this.doc = doc;
    this.views = new LayerViews(doc);
  }

  get contentW(): number {
    return this.doc.width;
  }

  get contentH(): number {
    return this.doc.height;
  }

  get maxZoom(): number {
    return TUNING.stage.zoom.max;
  }

  initialZoom(camera: Camera): number {
    return Math.min(camera.fitZoom(), TUNING.stage.zoom.fitMax);
  }

  attach(host: StageHost | null): void {
    if (host === this.host) return;
    this.stopViews?.();
    this.stopViews = null;
    this.host = host;
    if (host) {
      this.stopViews = this.views.connect(() => host.invalidate());
    } else {
      this.views.dispose();
    }
  }

  draw(ctx: CanvasRenderingContext2D, _now: number): boolean {
    const host = this.host;
    if (!host) return false;
    const camera = host.camera;
    const stage = contentRect(camera);
    drawFrameShadow(ctx, stage);

    const pattern = checkerPattern(ctx);
    if (typeof pattern !== 'string') pattern.setTransform(new DOMMatrix([1, 0, 0, 1, stage.x, stage.y]));
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = pattern;
    ctx.fillRect(stage.x, stage.y, stage.w, stage.h);
    ctx.imageSmoothingEnabled = smoothing;

    ctx.save();
    ctx.beginPath();
    ctx.rect(stage.x, stage.y, stage.w, stage.h);
    ctx.clip();
    const visible = visibleDoc(camera);
    const preview = this.doc.preview;
    for (const layer of this.doc.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      ctx.globalAlpha = layer.opacity;
      if (preview && preview.layerId === layer.id) this.drawWithPreview(ctx, camera, layer, preview, visible);
      else drawImageView(ctx, camera, this.views.viewOf(layer), layer.x, layer.y, 1, visible);
    }
    ctx.restore();

    drawFrameEdge(ctx, stage, host.dpr);
    return false;
  }

  drawFx(fx: CanvasRenderingContext2D, now: number): boolean {
    const host = this.host;
    if (!host) return false;
    let alive = false;
    for (const overlay of OVERLAYS) {
      fx.save();
      if (overlay.drawFx(fx, host, now)) alive = true;
      fx.restore();
    }
    return alive;
  }

  /** The layer outside preview.rect, then the preview image scaled into preview.rect. */
  private drawWithPreview(ctx: CanvasRenderingContext2D, camera: Camera, layer: Layer, preview: LayerPreview, visible: VisibleDoc): void {
    const zoom = camera.zoom;
    const area: Rect = {
      x: camera.panX + (layer.x + preview.rect.x) * zoom,
      y: camera.panY + (layer.y + preview.rect.y) * zoom,
      w: preview.rect.w * zoom,
      h: preview.rect.h * zoom,
    };
    ctx.save();
    const outside = new Path2D();
    outside.rect(0, 0, camera.viewW, camera.viewH);
    outside.rect(area.x, area.y, area.w, area.h);
    ctx.clip(outside, 'evenodd');
    drawImageView(ctx, camera, this.views.viewOf(layer), layer.x, layer.y, 1, visible);
    ctx.restore();

    const scale = preview.scale > 0 ? preview.scale : 1;
    drawImageView(ctx, camera, this.views.viewOfImage(preview.image), layer.x + preview.rect.x, layer.y + preview.rect.y, scale, null);
  }
}

function visibleDoc(camera: Camera): VisibleDoc {
  const a = camera.screenToImage(0, 0);
  const b = camera.screenToImage(camera.viewW, camera.viewH);
  return { x0: Math.floor(a.x) - 1, y0: Math.floor(a.y) - 1, x1: Math.ceil(b.x) + 1, y1: Math.ceil(b.y) + 1 };
}

/**
 * Draws the tiles of a view with its top-left corner at (x, y) in document px. `scale` = view px per document px.
 * With `visible`, only the source part inside the view is drawn, so a deep zoom never asks for a huge destination.
 */
function drawImageView(ctx: CanvasRenderingContext2D, camera: Camera, view: ImageView, x: number, y: number, scale: number, visible: VisibleDoc | null): void {
  const zoom = camera.zoom;
  for (const tile of view.tiles) {
    if (tile.canvas.width === 0) continue;
    const tx = x + tile.x / scale;
    const ty = y + tile.y / scale;
    if (!visible || scale !== 1) {
      ctx.drawImage(tile.canvas, camera.panX + tx * zoom, camera.panY + ty * zoom, (tile.w / scale) * zoom, (tile.h / scale) * zoom);
      continue;
    }
    const x0 = Math.max(tx, visible.x0);
    const y0 = Math.max(ty, visible.y0);
    const x1 = Math.min(tx + tile.w, visible.x1);
    const y1 = Math.min(ty + tile.h, visible.y1);
    if (x1 <= x0 || y1 <= y0) continue;
    ctx.drawImage(tile.canvas, x0 - tx, y0 - ty, x1 - x0, y1 - y0, camera.panX + x0 * zoom, camera.panY + y0 * zoom, (x1 - x0) * zoom, (y1 - y0) * zoom);
  }
}
