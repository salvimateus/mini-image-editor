import type { GridSpec } from '../../app/doc.svelte.ts';
import { gridLines } from '../../app/snapping.ts';
import { app } from '../../app/state.svelte.ts';
import { TUNING } from '../../app/tuning/index.ts';
import { contentRect, snap, STAGE_COLORS } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

interface GridLine {
  pos: number;
  strong: boolean;
}

/**
 * The grid lines of one axis between `from` and `to` (document px). Lines that would be closer than the minimum on
 * screen are thinned out to every n-th line, and every fourth drawn line is stronger.
 */
function axisLines(grid: GridSpec, length: number, divisions: number, zoom: number, from: number, to: number): GridLine[] {
  const minGap = TUNING.geometry.grid.minScreenPx;
  const out: GridLine[] = [];
  if (grid.mode === 'divisions') {
    const lines = gridLines(grid, length, divisions);
    const gap = (length / (lines.length + 1)) * zoom;
    const stride = Math.max(1, Math.ceil(minGap / Math.max(gap, 1e-6)));
    for (let i = stride - 1; i < lines.length; i += stride) if (lines[i] >= from && lines[i] <= to) out.push({ pos: lines[i], strong: false });
    return out;
  }
  if (!(grid.spacing > 0)) return out;
  const stride = Math.max(1, Math.ceil(minGap / (grid.spacing * zoom)));
  const step = grid.spacing * stride;
  const first = Math.max(1, Math.ceil(Math.max(0, from) / step));
  for (let n = first; n * step < length - 1e-6 && n * step <= to; n++) out.push({ pos: n * step, strong: n % 4 === 0 });
  return out;
}

/** The document grid inside the stage, when the grid view is on. */
export const gridOverlay: SceneOverlay = {
  z: 20,
  drawFx(fx, host) {
    const doc = app.doc;
    if (!doc || !app.view.grid) return false;
    const camera = host.camera;
    const stage = contentRect(camera);
    const x0 = Math.max(0, stage.x);
    const y0 = Math.max(0, stage.y);
    const x1 = Math.min(camera.viewW, stage.x + stage.w);
    const y1 = Math.min(camera.viewH, stage.y + stage.h);
    if (x1 <= x0 || y1 <= y0) return false;
    const zoom = camera.zoom;
    const grid = doc.grid;
    const xs = axisLines(grid, doc.width, grid.cols, zoom, (x0 - camera.panX) / zoom, (x1 - camera.panX) / zoom);
    const ys = axisLines(grid, doc.height, grid.rows, zoom, (y0 - camera.panY) / zoom, (y1 - camera.panY) / zoom);
    const dpr = host.dpr;
    for (const strong of [false, true]) {
      fx.beginPath();
      for (const line of xs) {
        if (line.strong !== strong) continue;
        const x = snap(camera.panX + line.pos * zoom, dpr);
        fx.moveTo(x, y0);
        fx.lineTo(x, y1);
      }
      for (const line of ys) {
        if (line.strong !== strong) continue;
        const y = snap(camera.panY + line.pos * zoom, dpr);
        fx.moveTo(x0, y);
        fx.lineTo(x1, y);
      }
      fx.strokeStyle = strong ? STAGE_COLORS.gridStrong : STAGE_COLORS.grid;
      fx.lineWidth = 1 / dpr;
      fx.stroke();
    }
    return false;
  },
};
