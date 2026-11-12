import { app } from '../../app/state.svelte.ts';
import { currentSelection, liveShape, type LiveShape } from '../../app/tools/marquee-rect.ts';
import { TUNING } from '../../app/tuning/index.ts';
import { maskOutline, type Mask } from '../../core/mask.ts';
import type { Camera } from '../camera.ts';
import { STAGE_COLORS, type StageHost } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

/** The outline of the last selection, in document px: built once for each selection. */
let outlineMask: Mask | null = null;
let outlinePath: Path2D | null = null;
let antsTimer: ReturnType<typeof setTimeout> | undefined;

function outlineOf(mask: Mask): Path2D {
  if (mask === outlineMask && outlinePath) return outlinePath;
  const path = new Path2D();
  for (const line of maskOutline(mask)) {
    if (line.length < 4) continue;
    path.moveTo(line[0], line[1]);
    for (let i = 2; i < line.length; i += 2) path.lineTo(line[i], line[i + 1]);
    path.closePath();
  }
  outlineMask = mask;
  outlinePath = path;
  return path;
}

function shapePath(shape: LiveShape): Path2D {
  const path = new Path2D();
  if (shape.kind === 'lasso') {
    const points = shape.points;
    if (points.length >= 2) {
      path.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) path.lineTo(points[i], points[i + 1]);
      path.closePath();
    }
    return path;
  }
  const { x, y, w, h } = shape.rect;
  if (shape.kind === 'rect') path.rect(x, y, w, h);
  else if (w > 0 && h > 0) path.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  return path;
}

/** A white line under a black dashed line, in document space; widths and dashes stay in screen px. */
function strokeAnts(fx: CanvasRenderingContext2D, camera: Camera, path: Path2D, offsetPx: number): void {
  const unit = 1 / camera.zoom;
  const dash = TUNING.select.ants.dashPx * unit;
  fx.save();
  fx.translate(camera.panX, camera.panY);
  fx.scale(camera.zoom, camera.zoom);
  fx.lineWidth = unit;
  fx.lineJoin = 'miter';
  fx.setLineDash([]);
  fx.strokeStyle = STAGE_COLORS.antsA;
  fx.stroke(path);
  fx.setLineDash([dash, dash]);
  fx.lineDashOffset = -offsetPx * unit;
  fx.strokeStyle = STAGE_COLORS.antsB;
  fx.stroke(path);
  fx.restore();
}

/** One more fx frame at the ants rate: the loop never runs at full speed for the ants. */
function scheduleAnts(host: StageHost): void {
  if (antsTimer !== undefined) return;
  antsTimer = setTimeout(() => {
    antsTimer = undefined;
    if (app.doc?.selection) host.invalidateFx();
  }, 1000 / TUNING.select.ants.fps);
}

/** The live shape of a selection drag and the marching ants of the selection (static under reduced motion). */
export const selectionOverlay: SceneOverlay = {
  z: 50,
  drawFx(fx, host, now) {
    const doc = app.doc;
    if (!doc) return false;
    const camera = host.camera;
    const shape = liveShape();
    const selection = currentSelection(doc);
    if (selection && !(shape && shape.op === 'replace')) {
      const { fps, stepPx, dashPx } = TUNING.select.ants;
      const tick = host.reducedMotion ? 0 : Math.floor((now * fps) / 1000);
      strokeAnts(fx, camera, outlineOf(selection), (tick * stepPx) % (dashPx * 2));
      if (!host.reducedMotion) scheduleAnts(host);
    } else if (!selection) {
      outlineMask = null;
      outlinePath = null;
    }
    if (shape) strokeAnts(fx, camera, shapePath(shape), 0);
    return false;
  },
};
