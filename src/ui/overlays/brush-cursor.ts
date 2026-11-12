import { app, type BrushToolId } from '../../app/state.svelte.ts';
import { TUNING } from '../../app/tuning/index.ts';
import { PARAMS } from '../../core/params/index.ts';
import type { Point } from '../../core/types.ts';
import { STAGE_COLORS, type StageHost } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

const BRUSH_TOOLS: ReadonlySet<string> = new Set<BrushToolId>(['brush', 'pencil', 'eraser', 'clone']);
const LABEL_FONT = "800 12px 'Nunito Variable', 'Nunito', system-ui, sans-serif";

/** The pointer in document px, or null when it is off the stage. */
let pointer: Point | null = null;
/** The ring is hidden while another cursor (the loupe, the clone source pick) shows. */
let ringHidden = false;
/** The clone source cross, in document px. */
let marker: Point | null = null;
let flash: { text: string; start: number } | null = null;

/** The paint tools tell the overlay where the pointer is (document px). */
export function setPaintPointer(point: Point | null, hideRing = false): void {
  const same = point && pointer ? point.x === pointer.x && point.y === pointer.y : point === pointer;
  if (same && hideRing === ringHidden) return;
  pointer = point ? { x: point.x, y: point.y } : null;
  ringHidden = hideRing;
  app.stage?.invalidateFx();
}

/** The cross that shows where the clone stamp copies from (document px). */
export function setCloneMarker(point: Point | null): void {
  if (point === marker || (point && marker && point.x === marker.x && point.y === marker.y)) return;
  marker = point ? { x: point.x, y: point.y } : null;
  app.stage?.invalidateFx();
}

/** A short label next to the cursor, after a change of size or hardness. */
export function flashBrush(text: string): void {
  flash = { text, start: performance.now() };
  app.stage?.invalidateFx();
}

function activeBrush(): BrushToolId | null {
  return BRUSH_TOOLS.has(app.tool) ? (app.tool as BrushToolId) : null;
}

function cross(fx: CanvasRenderingContext2D, x: number, y: number, arm: number): void {
  fx.beginPath();
  fx.moveTo(x - arm, y);
  fx.lineTo(x + arm, y);
  fx.moveTo(x, y - arm);
  fx.lineTo(x, y + arm);
}

/** A line in two strokes, dark under light, so it shows on any image. */
function contrastStroke(fx: CanvasRenderingContext2D, path: () => void, dash: number[] = []): void {
  fx.setLineDash(dash);
  path();
  fx.lineWidth = 3;
  fx.strokeStyle = STAGE_COLORS.black;
  fx.globalAlpha = 0.55;
  fx.stroke();
  fx.lineWidth = 1;
  fx.strokeStyle = STAGE_COLORS.white;
  fx.globalAlpha = 1;
  fx.stroke();
  fx.setLineDash([]);
}

function drawLabel(fx: CanvasRenderingContext2D, text: string, x: number, y: number, alpha: number): void {
  fx.font = LABEL_FONT;
  const width = fx.measureText(text).width + 16;
  const height = 22;
  fx.globalAlpha = alpha;
  fx.fillStyle = STAGE_COLORS.panel;
  fx.strokeStyle = STAGE_COLORS.panelEdge;
  fx.lineWidth = 1;
  fx.beginPath();
  fx.roundRect(x - width / 2, y - height / 2, width, height, height / 2);
  fx.fill();
  fx.stroke();
  fx.fillStyle = STAGE_COLORS.white;
  fx.textAlign = 'center';
  fx.textBaseline = 'middle';
  fx.fillText(text, x, y + 1);
  fx.globalAlpha = 1;
}

function draw(fx: CanvasRenderingContext2D, host: StageHost, now: number): boolean {
  const tool = activeBrush();
  if (!tool || !app.doc) {
    flash = null;
    return false;
  }
  const { cursor, flash: flashTiming } = TUNING.paint;
  const camera = host.camera;
  const settings = app.brush[tool];
  const size = Math.min(PARAMS.paint.maxSize, settings.size);

  if (tool === 'clone' && marker) {
    const m = camera.imageToScreen(marker.x, marker.y);
    contrastStroke(fx, () => cross(fx, m.x, m.y, cursor.sourceCrossPx));
  }

  let alive = false;
  let flashAlpha = 0;
  if (flash) {
    const age = now - flash.start;
    const total = flashTiming.showMs + flashTiming.fadeMs;
    if (age >= total || age < 0) flash = null;
    else {
      alive = true;
      flashAlpha = host.reducedMotion || age <= flashTiming.showMs ? 1 : 1 - (age - flashTiming.showMs) / flashTiming.fadeMs;
    }
  }

  // With no pointer on the stage, a size change shows the ring at the stage center.
  const at = pointer ? camera.imageToScreen(pointer.x, pointer.y) : flash ? { x: camera.viewW / 2, y: camera.viewH / 2 } : null;
  if (!at) return alive;
  const radius = (size / 2) * camera.zoom;
  if (!ringHidden || !pointer) {
    if (radius < cursor.minRingPx) {
      contrastStroke(fx, () => cross(fx, at.x, at.y, cursor.crossPx));
    } else {
      contrastStroke(fx, () => {
        fx.beginPath();
        fx.arc(at.x, at.y, radius, 0, Math.PI * 2);
      });
      const inner = radius * settings.hardness;
      if (tool !== 'pencil' && settings.hardness < 0.95 && inner > 4) {
        contrastStroke(
          fx,
          () => {
            fx.beginPath();
            fx.arc(at.x, at.y, inner, 0, Math.PI * 2);
          },
          [3, 4],
        );
      }
      if (radius > cursor.crossPx * 3) contrastStroke(fx, () => cross(fx, at.x, at.y, 2));
    }
  }
  if (flash && flashAlpha > 0) drawLabel(fx, flash.text, at.x, at.y + Math.max(radius, cursor.crossPx) + 18, flashAlpha);
  return alive;
}

/** The outline of the brush tip at its real size, the clone source cross and the size flash. */
export const brushCursorOverlay: SceneOverlay = {
  z: 90,
  drawFx: draw,
};
