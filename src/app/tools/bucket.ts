import { toCss } from '../../core/color.ts';
import { fillMask, floodMask } from '../../core/fill.ts';
import { coverage } from '../../core/mask.ts';
import { cropRaster } from '../../core/raster.ts';
import { STAGE_COLORS, type StagePointer } from '../../ui/stage-renderer.ts';
import { t } from '../i18n/index.ts';
import * as sfx from '../sfx.ts';
import { app } from '../state.svelte.ts';
import { TUNING } from '../tuning/index.ts';
import { beginPick, cancelPick, endPick, pickMove, pickOnce, type PickSession } from './eyedropper.ts';
import type { ToolController } from './types.ts';

function burst(p: StagePointer): void {
  const stage = app.stage;
  if (!stage || stage.host.reducedMotion) return;
  const fill = TUNING.paint.fillBurst;
  const color = toCss(app.fg);
  stage.particles.burst(p.sx, p.sy, {
    count: fill.count,
    colors: [color, color, color, STAGE_COLORS.white],
    speed: fill.speed,
    life: fill.life,
    size: fill.size,
    jitter: fill.jitter,
    gravity: TUNING.paint.burstGravity,
  });
  stage.invalidateFx();
}

const NOTHING_TO_FILL = Symbol('nothing-to-fill');

/** Floods the raw pixels of the paint target at the click (outside its image = transparent) and fills that region with the foreground color. */
function fillAt(p: StagePointer): void {
  const doc = app.doc;
  if (!doc) return;
  const x = Math.floor(p.ix);
  const y = Math.floor(p.iy);
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) {
    app.refuse(t('paint.toast.outside'));
    return;
  }
  const selection = doc.selection;
  if (selection && coverage(selection, x, y) === 0) {
    app.refuse(t('paint.toast.nothingToFill'));
    return;
  }
  const active = doc.active;
  if (active && active.kind === 'raster' && !active.generator && !active.visible) {
    app.refuse(t('paint.toast.hiddenLayer'));
    return;
  }
  try {
    doc.batch('paint.history.fill', () => {
      const layer = doc.paintTarget();
      const source = cropRaster(layer.image, { x: -layer.x, y: -layer.y, w: doc.width, h: doc.height });
      const mask = floodMask(source, x, y, { tolerance: app.bucket.tolerance, contiguous: app.bucket.contiguous, antiAlias: true });
      const patch = fillMask(layer.image, mask, app.fg, 1, selection, { x: layer.x, y: layer.y });
      // The throw makes the batch undo a layer that paintTarget added for this fill.
      if (!patch) throw NOTHING_TO_FILL;
      doc.commitPatch(layer.id, patch, 'paint.history.fill');
    });
  } catch (error) {
    if (error !== NOTHING_TO_FILL) throw error;
    app.refuse(t('paint.toast.nothingToFill'));
    return;
  }
  app.remember(app.fg);
  sfx.play('fill');
  burst(p);
}

let pick: PickSession | null = null;

/** A click fills the region of similar color (tolerance, contiguous), inside the selection. Alt+click picks a color. */
export const bucketTool: ToolController = {
  id: 'bucket',
  hints: [
    { keys: 'Click', text: 'paint.hint.fill' },
    { keys: 'Alt+Click', text: 'paint.hint.pick' },
  ],
  cursor: () => 'crosshair',
  down(p) {
    if (!app.doc) return false;
    if (p.alt) {
      pick = beginPick();
      pickMove(pick, p);
      return true;
    }
    try {
      fillAt(p);
    } catch (error) {
      app.fail(error);
    }
    return false;
  },
  move(p) {
    if (pick) pickMove(pick, p);
  },
  up(p) {
    if (!pick) return;
    endPick(pick, p);
    pick = null;
  },
  altClick(p) {
    if (app.doc) pickOnce(p);
  },
  key(e) {
    if (e.key !== 'Escape' || !pick) return false;
    cancelPick(pick);
    pick = null;
    return true;
  },
  deactivate() {
    if (pick) endPick(pick, null);
    pick = null;
  },
};
