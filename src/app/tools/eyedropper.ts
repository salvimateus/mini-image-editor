import { toCss } from '../../core/color.ts';
import type { Rgba } from '../../core/types.ts';
import { showLoupe } from '../../ui/overlays/loupe.ts';
import { STAGE_COLORS, type StagePointer } from '../../ui/stage-renderer.ts';
import * as sfx from '../sfx.ts';
import { app } from '../state.svelte.ts';
import { TUNING } from '../tuning/index.ts';
import type { ToolController } from './types.ts';

/** A pick in progress: the color before it, for Esc, and the last picked color. */
export interface PickSession { before: Rgba; picked: Rgba | null }

/** The composite color under the pointer, or null on a transparent pixel or off the stage. */
export function sampleAt(p: StagePointer): Rgba | null {
  const doc = app.doc;
  if (!doc) return null;
  const color = doc.sample(Math.floor(p.ix), Math.floor(p.iy));
  return color.a > 0 ? { ...color, a: 255 } : null;
}

export function beginPick(): PickSession {
  return { before: app.fg, picked: null };
}

/** Puts the color under the pointer into the foreground color (not yet in the recent list) and moves the loupe. */
export function pickMove(session: PickSession, p: StagePointer): void {
  showLoupe({ x: p.ix, y: p.iy });
  const color = sampleAt(p);
  if (!color) return;
  session.picked = color;
  app.setFg(color, false);
}

/** Ends the pick: the color goes into the recent list, with the sound and a small pop at the pointer. */
export function endPick(session: PickSession, p: StagePointer | null, keepLoupe = false): void {
  if (!keepLoupe) showLoupe(null);
  const color = session.picked;
  if (!color) {
    // A release on a transparent pixel picks nothing: a soft sound says so.
    if (p) sfx.play('cancel');
    return;
  }
  app.setFg(color, true);
  sfx.play('pick');
  const stage = app.stage;
  if (!stage || !p || stage.host.reducedMotion) return;
  const burst = TUNING.paint.pickBurst;
  stage.particles.burst(p.sx, p.sy, {
    count: burst.count,
    colors: [toCss(color), toCss(color), STAGE_COLORS.white],
    speed: burst.speed,
    life: burst.life,
    size: burst.size,
    jitter: burst.jitter,
    gravity: TUNING.paint.burstGravity,
  });
  stage.invalidateFx();
}

/** Esc during a pick: the foreground color goes back. */
export function cancelPick(session: PickSession): void {
  showLoupe(null);
  app.setFg(session.before, false);
}

/** A single pick (a right click, an Alt+click of a paint tool). */
export function pickOnce(p: StagePointer): void {
  const session = beginPick();
  pickMove(session, p);
  endPick(session, p);
}

let session: PickSession | null = null;

/** A click or a drag puts the color under the pointer into the foreground color; the loupe follows the pointer. */
export const eyedropperTool: ToolController = {
  id: 'eyedropper',
  hints: [
    { keys: 'Click', text: 'paint.hint.pickClick' },
    { keys: 'Drag', text: 'paint.hint.pickDrag' },
  ],
  cursor: (p) => (p ? 'none' : 'crosshair'),
  hover(p) {
    if (!session) showLoupe(p ? { x: p.ix, y: p.iy } : null);
  },
  down(p) {
    if (!app.doc) return false;
    session = beginPick();
    pickMove(session, p);
    return true;
  },
  move(p) {
    if (session) pickMove(session, p);
  },
  up(p) {
    if (!session) return;
    endPick(session, p, true);
    session = null;
  },
  altClick(p) {
    if (!app.doc) return;
    const once = beginPick();
    pickMove(once, p);
    endPick(once, p, true);
  },
  key(e) {
    if (e.key !== 'Escape' || !session) return false;
    cancelPick(session);
    sfx.play('cancel');
    session = null;
    return true;
  },
  deactivate() {
    if (session) endPick(session, null);
    session = null;
    showLoupe(null);
  },
};
