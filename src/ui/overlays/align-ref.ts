import { alignOutline } from '../../app/align-reference.svelte.ts';
import { app } from '../../app/state.svelte.ts';
import { TUNING } from '../../app/tuning/index.ts';
import { snap, snapEdge, STAGE_COLORS } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

/** The outline of the align reference: while the align bar is in use, and for a short time after each align. */
export const alignRefOverlay: SceneOverlay = {
  z: 65,
  drawFx(fx, host, now) {
    const doc = app.doc;
    if (!doc) return false;
    const { holdMs, fadeMs, dashPx } = TUNING.select.alignRef;
    const outline = alignOutline(doc, now, holdMs + fadeMs);
    if (!outline) return false;
    const { rect, at } = outline;
    const fading = at >= 0 && !host.reducedMotion && now - at > holdMs;
    const camera = host.camera;
    const dpr = host.dpr;
    const x0 = camera.panX + rect.x * camera.zoom;
    const y0 = camera.panY + rect.y * camera.zoom;
    const x1 = camera.panX + (rect.x + rect.w) * camera.zoom;
    const y1 = camera.panY + (rect.y + rect.h) * camera.zoom;
    fx.save();
    fx.globalAlpha = fading ? 1 - (now - at - holdMs) / fadeMs : 1;
    fx.fillStyle = STAGE_COLORS.accentFill;
    const fl = snapEdge(x0, dpr);
    const ft = snapEdge(y0, dpr);
    fx.fillRect(fl, ft, snapEdge(x1, dpr) - fl, snapEdge(y1, dpr) - ft);
    const l = snap(x0, dpr);
    const t = snap(y0, dpr);
    const w = snap(x1, dpr) - l;
    const h = snap(y1, dpr) - t;
    fx.lineWidth = 3;
    fx.strokeStyle = STAGE_COLORS.black;
    fx.strokeRect(l, t, w, h);
    fx.lineWidth = 1.5;
    fx.setLineDash([dashPx, dashPx * 0.66]);
    fx.strokeStyle = STAGE_COLORS.accent;
    fx.strokeRect(l, t, w, h);
    fx.restore();
    // The loop runs until the flash is over; a steady outline needs no frames.
    return at >= 0;
  },
};
