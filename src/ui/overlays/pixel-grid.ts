import { app } from '../../app/state.svelte.ts';
import { TUNING } from '../../app/tuning/index.ts';
import { contentRect, snap, STAGE_COLORS } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

/** A line between each two document pixels of the visible stage, above 800% zoom. */
export const pixelGridOverlay: SceneOverlay = {
  z: 10,
  drawFx(fx, host) {
    const camera = host.camera;
    const zoom = camera.zoom;
    if (!app.doc || zoom <= TUNING.geometry.pixelGridAbove) return false;
    const stage = contentRect(camera);
    const x0 = Math.max(0, stage.x);
    const y0 = Math.max(0, stage.y);
    const x1 = Math.min(camera.viewW, stage.x + stage.w);
    const y1 = Math.min(camera.viewH, stage.y + stage.h);
    if (x1 <= x0 || y1 <= y0) return false;
    const dpr = host.dpr;
    fx.beginPath();
    for (let i = Math.ceil((x0 - camera.panX) / zoom); camera.panX + i * zoom <= x1; i++) {
      const x = snap(camera.panX + i * zoom, dpr);
      fx.moveTo(x, y0);
      fx.lineTo(x, y1);
    }
    for (let i = Math.ceil((y0 - camera.panY) / zoom); camera.panY + i * zoom <= y1; i++) {
      const y = snap(camera.panY + i * zoom, dpr);
      fx.moveTo(x0, y);
      fx.lineTo(x1, y);
    }
    // Fades in from the threshold, so the grid does not pop in at once.
    fx.globalAlpha = Math.min(1, (zoom - TUNING.geometry.pixelGridAbove) / TUNING.geometry.pixelGridAbove + 0.35);
    fx.strokeStyle = STAGE_COLORS.grid;
    fx.lineWidth = 1 / dpr;
    fx.stroke();
    fx.globalAlpha = 1;
    return false;
  },
};
