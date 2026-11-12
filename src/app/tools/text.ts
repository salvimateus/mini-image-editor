import { opaqueBounds } from '../../core/raster.ts';
import type { RasterImage, Rect } from '../../core/types.ts';
import { sparkColors, type StagePointer } from '../../ui/stage-renderer.ts';
import { textSession } from '../fonts/text-session.svelte.ts';
import type { TextLayer } from '../layers.ts';
import * as sfx from '../sfx.ts';
import { clearSnapFeedback, snapBoxLive } from '../snap-feedback.svelte.ts';
import { app } from '../state.svelte.ts';
import { TUNING } from '../tuning/index.ts';
import type { ToolController } from './types.ts';

/** A press on a text layer: it becomes a move after the drag threshold, else a click that opens the text. */
interface Press {
  id: number;
  sx: number;
  sy: number;
  ix: number;
  iy: number;
  layerX: number;
  layerY: number;
  /** The visible pixels at the press, in document px: the box that snaps. */
  box: Rect;
  moved: boolean;
  coalesce: string;
}

let press: Press | null = null;
let pressSerial = 0;

/** The ink bounds of each text image, in image px; a text image never changes in place. */
const inkCache = new WeakMap<RasterImage, Rect | null>();

function inkBounds(layer: TextLayer): Rect | null {
  let bounds = inkCache.get(layer.image);
  if (bounds === undefined) {
    bounds = opaqueBounds(layer.image);
    inkCache.set(layer.image, bounds);
  }
  return bounds ? { x: bounds.x + layer.x, y: bounds.y + layer.y, w: bounds.w, h: bounds.h } : null;
}

/** The top visible text layer whose letters are under the point (with a few screen px of slack). */
function textAt(x: number, y: number): TextLayer | null {
  const doc = app.doc;
  if (!doc) return null;
  const slack = 4 / Math.max(app.zoom, 0.01);
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i];
    if (layer.kind !== 'text' || !layer.visible) continue;
    const box = inkBounds(layer);
    if (box && x >= box.x - slack && y >= box.y - slack && x < box.x + box.w + slack && y < box.y + box.h + slack) return layer;
  }
  return null;
}

function sparkle(p: StagePointer): void {
  const stage = app.stage;
  if (!stage) return;
  const burst = TUNING.text.createBurst;
  stage.particles.burst(p.sx, p.sy, { count: burst.count, colors: sparkColors(), speed: burst.speed, life: burst.life, size: burst.size });
  stage.host.invalidateFx();
}

/** A click writes a new text at the point or opens a text for editing; a drag on a text moves it, with snap. */
export const textTool: ToolController = {
  id: 'text',
  hints: [
    { keys: 'Click', text: 'text.hint.click' },
    { keys: 'Drag', text: 'text.hint.drag' },
    { keys: 'Ctrl+Drag', text: 'text.hint.free' },
    { keys: 'Esc', text: 'text.hint.done' },
  ],
  cursor(p) {
    if (press?.moved) return 'move';
    if (!p) return 'text';
    const hit = textAt(p.ix, p.iy);
    if (!hit) return 'text';
    return hit.id === app.doc?.activeId ? 'move' : 'pointer';
  },
  down(p) {
    const doc = app.doc;
    if (!doc) return false;
    const hit = textAt(p.ix, p.iy);
    if (!hit) {
      textSession.begin({ x: p.ix, y: p.iy });
      sfx.play('tool');
      sparkle(p);
      return false;
    }
    if (doc.activeId !== hit.id) doc.setActive(hit.id);
    pressSerial += 1;
    press = {
      id: hit.id,
      sx: p.sx,
      sy: p.sy,
      ix: p.ix,
      iy: p.iy,
      layerX: hit.x,
      layerY: hit.y,
      box: inkBounds(hit) ?? { x: hit.x, y: hit.y, w: hit.image.width, h: hit.image.height },
      moved: false,
      coalesce: `text-drag-${pressSerial}`,
    };
    return true;
  },
  move(p) {
    const doc = app.doc;
    const drag = press;
    if (!doc || !drag) return;
    if (!drag.moved && Math.hypot(p.sx - drag.sx, p.sy - drag.sy) < TUNING.text.dragThresholdPx) return;
    drag.moved = true;
    const dx = Math.round(p.ix - drag.ix);
    const dy = Math.round(p.iy - drag.iy);
    const snap = snapBoxLive({ x: drag.box.x + dx, y: drag.box.y + dy, w: drag.box.w, h: drag.box.h }, p.ctrl);
    doc.setLayerProps(drag.id, { x: drag.layerX + dx + snap.dx, y: drag.layerY + dy + snap.dy }, drag.coalesce);
  },
  up() {
    const drag = press;
    press = null;
    if (!drag) return;
    if (drag.moved) {
      clearSnapFeedback();
      sfx.play('tick');
      return;
    }
    textSession.edit(drag.id);
    sfx.play('tick');
  },
  key(e) {
    if (e.key !== 'Escape' || app.panel !== 'text') return false;
    app.openPanel('none');
    sfx.play('tick');
    return true;
  },
  deactivate() {
    if (press?.moved) clearSnapFeedback();
    press = null;
    textSession.end();
  },
};
