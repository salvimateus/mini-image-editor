import { snapFlashState } from '../../app/snap-feedback.svelte.ts';
import type { SnapTarget } from '../../app/snapping.ts';
import { TUNING } from '../../app/tuning/index.ts';
import { easeOutCubic, progress, snap, STAGE_COLORS, type StageHost } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

function strokeTargets(fx: CanvasRenderingContext2D, host: StageHost, targets: readonly SnapTarget[], width: number): void {
  const camera = host.camera;
  const overhang = TUNING.geometry.snap.layerOverhangPx;
  fx.beginPath();
  for (const target of targets) {
    // A layer hit is a segment over the moved box and the target layer; the other kinds cross the whole view.
    const span = target.span;
    if (target.axis === 'x') {
      const x = snap(camera.panX + target.pos * camera.zoom, host.dpr);
      fx.moveTo(x, span ? camera.panY + span[0] * camera.zoom - overhang : 0);
      fx.lineTo(x, span ? camera.panY + span[1] * camera.zoom + overhang : camera.viewH);
    } else {
      const y = snap(camera.panY + target.pos * camera.zoom, host.dpr);
      fx.moveTo(span ? camera.panX + span[0] * camera.zoom - overhang : 0, y);
      fx.lineTo(span ? camera.panX + span[1] * camera.zoom + overhang : camera.viewW, y);
    }
  }
  fx.lineWidth = width;
  fx.stroke();
}

/** The lines that the last snap hit: a short flash on a new hit, steady while it holds, a fade after the drag. */
export const snapFlashOverlay: SceneOverlay = {
  z: 80,
  drawFx(fx, host, now) {
    const state = snapFlashState();
    const { flashMs, fadeMs, flashGrowPx } = TUNING.geometry.snap;
    const thin = 1 / host.dpr;
    fx.strokeStyle = STAGE_COLORS.snap;
    let alive = false;
    if (state.hits.length > 0) {
      const k = host.reducedMotion ? 1 : progress(now, state.hitAt, flashMs);
      if (k < 1) {
        fx.globalAlpha = 0.45 * (1 - easeOutCubic(k));
        strokeTargets(fx, host, state.hits, thin + flashGrowPx * (1 - k));
        alive = true;
      }
      fx.globalAlpha = 1;
      strokeTargets(fx, host, state.hits, thin);
      return alive;
    }
    if (state.released.length > 0 && state.releasedAt >= 0 && !host.reducedMotion) {
      const k = progress(now, state.releasedAt, fadeMs);
      if (k < 1) {
        fx.globalAlpha = 1 - k;
        strokeTargets(fx, host, state.released, thin);
        fx.globalAlpha = 1;
        alive = true;
      }
    }
    return alive;
  },
};
