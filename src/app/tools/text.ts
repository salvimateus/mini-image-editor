import { opaqueBounds } from '../../core/raster.ts';
import type { RasterImage, Rect } from '../../core/types.ts';
import { textBoxHandleAt } from '../../ui/overlays/text-box.ts';
import { sparkColors, type StagePointer } from '../../ui/stage-renderer.ts';
import { textSession } from '../fonts/text-session.svelte.ts';
import { areaWidth, textBox } from '../text-render.ts';
import type { TextLayer } from '../layers.ts';
import * as sfx from '../sfx.ts';
import { clearSnapFeedback, snapBoxLive } from '../snap-feedback.svelte.ts';
import type { SnapTarget } from '../snapping.ts';
import { app } from '../state.svelte.ts';
import { TUNING } from '../tuning/index.ts';
import { layerSnapSource } from './move.ts';
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
  layers: () => readonly SnapTarget[];
}

/** A press on an empty area: a click makes a free text, a drag marks the box of an area text. */
interface Create {
  sx: number;
  sy: number;
  ix: number;
  iy: number;
  /** The marked box in document px, once the drag passes the threshold. */
  box: Rect | null;
}

let press: Press | null = null;
let create: Create | null = null;
let pressSerial = 0;

/** The box that a drag of the text tool marks now, in document px, or null. The text-box overlay draws it. */
export function textCreateBox(): Rect | null {
  return create?.box ?? null;
}

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

/** The top visible text layer whose letters (or the wrap box of an area text) are under the point, with a few screen px of slack. */
function textAt(x: number, y: number): TextLayer | null {
  const doc = app.doc;
  if (!doc) return null;
  const slack = 4 / Math.max(app.zoom, 0.01);
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i];
    if (layer.kind !== 'text' || !layer.visible) continue;
    const ink = inkBounds(layer);
    const box = areaWidth(layer.spec) !== null ? unionBox(textBox(layer), ink) : ink;
    if (box && x >= box.x - slack && y >= box.y - slack && x < box.x + box.w + slack && y < box.y + box.h + slack) return layer;
  }
  return null;
}

function unionBox(a: Rect, b: Rect | null): Rect {
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function sparkle(p: StagePointer): void {
  const stage = app.stage;
  if (!stage) return;
  const burst = TUNING.text.createBurst;
  stage.particles.burst(p.sx, p.sy, { count: burst.count, colors: sparkColors(), speed: burst.speed, life: burst.life, size: burst.size });
  stage.host.invalidateFx();
}

/**
 * A click writes a free text at the point or opens a text for editing. A drag on an empty area marks the box of an
 * area text; a drag on a text moves it, with snap.
 */
export const textTool: ToolController = {
  id: 'text',
  hints: [
    { keys: 'Click', text: 'text.hint.click' },
    { keys: 'Drag', text: 'text.hint.area' },
    { keys: 'Ctrl+Drag', text: 'text.hint.free' },
    { keys: 'Esc', text: 'text.hint.done' },
  ],
  cursor(p) {
    if (press?.moved) return 'move';
    if (!p) return 'text';
    if (textBoxHandleAt(p)) return 'ew-resize';
    const hit = textAt(p.ix, p.iy);
    if (!hit) return 'text';
    return hit.id === app.doc?.activeId ? 'move' : 'pointer';
  },
  down(p) {
    const doc = app.doc;
    if (!doc) return false;
    const hit = textAt(p.ix, p.iy);
    if (!hit) {
      create = { sx: p.sx, sy: p.sy, ix: p.ix, iy: p.iy, box: null };
      return true;
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
      layers: layerSnapSource(doc, hit.id),
    };
    return true;
  },
  move(p) {
    const making = create;
    if (making) {
      if (!making.box && Math.hypot(p.sx - making.sx, p.sy - making.sy) < TUNING.text.areaThresholdPx) return;
      const x = Math.round(Math.min(making.ix, p.ix));
      const y = Math.round(Math.min(making.iy, p.iy));
      making.box = { x, y, w: Math.round(Math.max(making.ix, p.ix)) - x, h: Math.round(Math.max(making.iy, p.iy)) - y };
      app.stage?.invalidateFx();
      return;
    }
    const doc = app.doc;
    const drag = press;
    if (!doc || !drag) return;
    if (!drag.moved && Math.hypot(p.sx - drag.sx, p.sy - drag.sy) < TUNING.text.dragThresholdPx) return;
    drag.moved = true;
    const dx = Math.round(p.ix - drag.ix);
    const dy = Math.round(p.iy - drag.iy);
    const snap = snapBoxLive({ x: drag.box.x + dx, y: drag.box.y + dy, w: drag.box.w, h: drag.box.h }, p.ctrl, drag.layers);
    doc.setLayerProps(drag.id, { x: drag.layerX + dx + snap.dx, y: drag.layerY + dy + snap.dy }, drag.coalesce);
  },
  up(p) {
    const making = create;
    create = null;
    if (making) {
      if (making.box) {
        textSession.begin({ x: making.box.x, y: making.box.y }, Math.max(making.box.w, TUNING.text.ranges.boxWidth.min));
      } else {
        textSession.begin({ x: making.ix, y: making.iy });
      }
      app.stage?.invalidateFx();
      sfx.play('tool');
      sparkle(p);
      return;
    }
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
    if (create?.box) app.stage?.invalidateFx();
    create = null;
    textSession.end();
  },
};
