import type { Point, ShapeSpec } from '../../core/types.ts';
import type { StagePointer } from '../../ui/stage-renderer.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import { createShapeLayer, shapeLayerName } from '../layers.ts';
import { renderShapeLayer } from '../shape-render.ts';
import * as sfx from '../sfx.ts';
import { clearSnapFeedback } from '../snap-feedback.svelte.ts';
import { app } from '../state.svelte.ts';
import { TUNING } from '../tuning/index.ts';
import {
  beginBodyDrag,
  bodyDragging,
  cancelShapeDrags,
  endBodyDrag,
  HANDLE_CURSORS,
  handleAt,
  holdAngle,
  leftClick,
  moveBodyDrag,
  placeAt,
  popAt,
  setCreating,
  setDraft,
  shapeLayerAt,
  snapPointLive,
} from './shape-edit.ts';
import { isArrowKind, shapeSettings, type ShapeKindId } from './shape-settings.svelte.ts';
import type { ToolController } from './types.ts';

/** A drag that makes a new shape: from the press point (a corner or the tail) to the pointer. */
interface Creation {
  doc: EditorDoc;
  kind: ShapeKindId;
  press: StagePointer;
  start: Point;
  moved: boolean;
  last: { spec: ShapeSpec; at: Point } | null;
}

let creation: Creation | null = null;

/** The shape between the start and the pointer: a box from corner to corner, or an arrow from tail to head. */
function dragShape(c: Creation, p: StagePointer): { spec: ShapeSpec; at: Point } {
  const min = TUNING.shapes.minPx;
  if (isArrowKind(c.kind)) {
    const end = p.shift ? holdAngle(c.start, { x: p.ix, y: p.iy }) : snapPointLive(p.ix, p.iy, p.ctrl);
    const spec = shapeSettings.arrowSpec(c.kind, Math.round(end.x - c.start.x), Math.round(end.y - c.start.y));
    return { spec, at: placeAt(spec, c.start) };
  }
  const end = snapPointLive(p.ix, p.iy, p.ctrl);
  let dx = end.x - c.start.x;
  let dy = end.y - c.start.y;
  if (p.shift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  }
  const x0 = Math.round(Math.min(c.start.x, c.start.x + dx));
  const y0 = Math.round(Math.min(c.start.y, c.start.y + dy));
  const x1 = Math.round(Math.max(c.start.x, c.start.x + dx));
  const y1 = Math.round(Math.max(c.start.y, c.start.y + dy));
  const spec = shapeSettings.boxSpec(c.kind === 'ellipse' ? 'ellipse' : 'rect', Math.max(min, x1 - x0), Math.max(min, y1 - y0));
  return { spec, at: placeAt(spec, { x: x0, y: y0 }) };
}

/** A click with no drag: a shape of the default size, centered at the click. */
function clickShape(c: Creation): { spec: ShapeSpec; at: Point } {
  const size = TUNING.shapes.clickSize;
  const { x, y } = c.start;
  if (isArrowKind(c.kind)) {
    const spec = shapeSettings.arrowSpec(c.kind, size.arrow, 0);
    return { spec, at: placeAt(spec, { x: x - size.arrow / 2, y }) };
  }
  const spec = shapeSettings.boxSpec(c.kind === 'ellipse' ? 'ellipse' : 'rect', size.w, size.h);
  return { spec, at: placeAt(spec, { x: x - size.w / 2, y: y - size.h / 2 }) };
}

function tooShort(spec: ShapeSpec): boolean {
  return spec.kind === 'arrow' && Math.hypot(spec.dx, spec.dy) < TUNING.shapes.minArrowPx;
}

function endCreation(): void {
  creation = null;
  setCreating(false);
  setDraft(null);
  clearSnapFeedback();
}

function commit(c: Creation, p: StagePointer): void {
  let shape = c.moved ? (c.last ?? dragShape(c, p)) : clickShape(c);
  if (tooShort(shape.spec)) shape = clickShape(c);
  endCreation();
  if (app.doc !== c.doc) return;
  try {
    const image = renderShapeLayer(shape.spec);
    const layer = createShapeLayer(shapeLayerName(shape.spec), shape.spec, image, shape.at.x, shape.at.y);
    c.doc.addLayer(layer, undefined, 'history.addShape');
    sfx.play('layer');
    const stage = app.stage;
    if (stage) {
      const center = stage.docToScreen(shape.at.x + image.width / 2, shape.at.y + image.height / 2);
      popAt(center.x, center.y);
    }
  } catch (error) {
    app.fail(error);
  }
}

/** U: a drag makes a rectangle, an ellipse or an arrow; a press on a shape selects it and moves it. */
export const shapeTool: ToolController = {
  id: 'shape',
  hints: [
    { keys: 'Drag', text: 'shapes.hint.draw' },
    { keys: 'Shift+Drag', text: 'shapes.hint.keep' },
    { keys: 'Ctrl+Drag', text: 'shapes.hint.noSnap' },
    { keys: 'Click', text: 'shapes.hint.click' },
    { keys: 'Drag', text: 'shapes.hint.move' },
  ],
  cursor(p) {
    if (bodyDragging()) return 'move';
    if (creation) return 'crosshair';
    if (!p) return 'crosshair';
    const handle = handleAt(p);
    if (handle) return HANDLE_CURSORS[handle];
    const doc = app.doc;
    return doc && shapeLayerAt(doc, p.ix, p.iy) ? 'move' : 'crosshair';
  },
  down(p) {
    const doc = app.doc;
    if (!doc) return false;
    const hit = shapeLayerAt(doc, p.ix, p.iy);
    if (hit) {
      beginBodyDrag(doc, hit, p);
      return true;
    }
    creation = { doc, kind: shapeSettings.value.kind, press: p, start: snapPointLive(Math.round(p.ix), Math.round(p.iy), p.ctrl), moved: false, last: null };
    setCreating(true);
    return true;
  },
  move(p) {
    if (bodyDragging()) {
      moveBodyDrag(p);
      return;
    }
    const c = creation;
    if (!c) return;
    if (!c.moved) {
      if (!leftClick(c.press, p)) return;
      c.moved = true;
    }
    c.last = dragShape(c, p);
    setDraft(c.last);
  },
  up(p) {
    if (bodyDragging()) {
      endBodyDrag();
      return;
    }
    const c = creation;
    if (c) commit(c, p);
  },
  key(e) {
    if (e.key !== 'Escape' || !creation) return false;
    endCreation();
    sfx.play('cancel');
    return true;
  },
  deactivate() {
    if (creation) endCreation();
    cancelShapeDrags();
  },
};
