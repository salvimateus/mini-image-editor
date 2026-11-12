import { app } from '../../app/state.svelte.ts';
import { TUNING } from '../../app/tuning/index.ts';
import { contentRect, STAGE_COLORS } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

/** The avatar preview: the stage outside the inscribed ellipse is dimmed, and a ring marks the ellipse. Never exported. */
export const avatarOverlay: SceneOverlay = {
  z: 30,
  drawFx(fx, host) {
    if (!app.doc || !app.view.avatar) return false;
    const stage = contentRect(host.camera);
    const cx = stage.x + stage.w / 2;
    const cy = stage.y + stage.h / 2;
    const rx = stage.w / 2;
    const ry = stage.h / 2;
    const shade = new Path2D();
    shade.rect(stage.x, stage.y, stage.w, stage.h);
    shade.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    fx.fillStyle = STAGE_COLORS.shade;
    fx.fill(shade, 'evenodd');
    const ring = TUNING.geometry.avatar.ringPx;
    fx.beginPath();
    fx.ellipse(cx, cy, Math.max(0, rx - ring / 2), Math.max(0, ry - ring / 2), 0, 0, Math.PI * 2);
    fx.strokeStyle = STAGE_COLORS.ring;
    fx.lineWidth = ring;
    fx.stroke();
    return false;
  },
};
