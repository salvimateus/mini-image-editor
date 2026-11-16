import { pendingHeals, type HoleCover } from '../../app/inpaint.ts';
import { app } from '../../app/state.svelte.ts';
import { TUNING } from '../../app/tuning/index.ts';
import { drawSprite } from './sprite.ts';
import type { SceneOverlay } from './types.ts';

/** The tinted hole of each job, built one time; a large hole gets a smaller canvas. */
const sprites = new WeakMap<HoleCover, HTMLCanvasElement>();

function spriteOf(hole: HoleCover): HTMLCanvasElement {
  const known = sprites.get(hole);
  if (known) return known;
  const { rect, data } = hole;
  const scale = Math.min(1, Math.sqrt(TUNING.paint.healMark.spriteMaxPx / Math.max(1, rect.w * rect.h)));
  const w = Math.max(1, Math.round(rect.w * scale));
  const h = Math.max(1, Math.round(rect.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const pixels = ctx.createImageData(w, h);
    const out = pixels.data;
    const tint = TUNING.paint.healTint;
    for (let y = 0; y < h; y++) {
      const sy = Math.min(rect.h - 1, Math.floor(((y + 0.5) * rect.h) / h));
      for (let x = 0; x < w; x++) {
        const cover = data[sy * rect.w + Math.min(rect.w - 1, Math.floor(((x + 0.5) * rect.w) / w))];
        if (cover === 0) continue;
        const o = (y * w + x) * 4;
        out[o] = tint.r;
        out[o + 1] = tint.g;
        out[o + 2] = tint.b;
        out[o + 3] = (cover * tint.a) / 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
  }
  sprites.set(hole, canvas);
  return canvas;
}

/** The holes of the fills that wait or run in the active document: they pulse, then fade when the result lands. */
export const healPendingOverlay: SceneOverlay = {
  z: 55,
  drawFx(fx, host, now) {
    const doc = app.doc;
    if (!doc) return false;
    const jobs = pendingHeals(doc);
    if (jobs.length === 0) return false;
    const { pulseMs, alpha, stillAlpha, fadeMs } = TUNING.paint.healMark;
    const still = host.reducedMotion;
    const pulse = still ? stillAlpha : alpha[0] + (alpha[1] - alpha[0]) * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / pulseMs));
    let animating = false;
    for (const job of jobs) {
      const layer = doc.layer(job.layerId);
      if (!layer) continue;
      let opacity = pulse;
      if (job.landedAt !== null) {
        const fade = 1 - (now - job.landedAt) / fadeMs;
        if (fade <= 0) continue;
        opacity = alpha[1] * fade;
        animating = true;
      } else if (!still) animating = true;
      const { rect } = job.hole;
      drawSprite(fx, host.camera, { canvas: spriteOf(job.hole), rect: { x: layer.x + rect.x, y: layer.y + rect.y, w: rect.w, h: rect.h }, opacity });
    }
    return animating;
  },
};
