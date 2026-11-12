import type { Point, ShapeSpec } from '../../core/types.ts';
import type { StagePointer } from '../../ui/stage-renderer.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import { createShapeLayer, shapeLayerName } from '../layers.ts';
import { loadShapeFont, renderShapeLayer, shapeFontReady } from '../shape-render.ts';
import * as sfx from '../sfx.ts';
import { clearSnapFeedback, snapBoxLive } from '../snap-feedback.svelte.ts';
import { app } from '../state.svelte.ts';
import {
  beginBodyDrag,
  bodyDragging,
  cancelShapeDrags,
  endBodyDrag,
  HANDLE_CURSORS,
  handleAt,
  leftClick,
  moveBodyDrag,
  placeAt,
  popAt,
  setCreating,
  setDraft,
  shapeLayerAt,
} from './shape-edit.ts';
import { shapeSettings } from './shape-settings.svelte.ts';
import type { ToolController } from './types.ts';

type StepSpec = Extract<ShapeSpec, { kind: 'step' }>;

/** A press that puts a step: the badge follows the pointer until the release. */
interface Placing {
  doc: EditorDoc;
  press: StagePointer;
  spec: StepSpec;
  center: Point;
  moved: boolean;
}

let placing: Placing | null = null;

/** The center snapped so that the badge box meets guides, grid, stage edges and stage center. */
function snappedCenter(spec: StepSpec, x: number, y: number, bypass: boolean): Point {
  const half = spec.size / 2;
  const snap = snapBoxLive({ x: x - half, y: y - half, w: spec.size, h: spec.size }, bypass);
  return { x: Math.round(x + snap.dx), y: Math.round(y + snap.dy) };
}

function showDraft(c: Placing): void {
  setDraft({ spec: c.spec, at: placeAt(c.spec, c.center) });
}

function endPlacing(): void {
  placing = null;
  setCreating(false);
  setDraft(null);
  clearSnapFeedback();
}

async function commit(c: Placing): Promise<void> {
  // The number uses the bundled UI font; it is almost always loaded already.
  if (!shapeFontReady()) {
    await loadShapeFont();
    // Esc or another tool during the wait cancels the step.
    if (placing !== c) return;
  }
  endPlacing();
  const doc = c.doc;
  if (app.doc !== doc) return;
  try {
    const spec: StepSpec = { ...c.spec, number: shapeSettings.nextNumber() };
    const image = renderShapeLayer(spec);
    const at = placeAt(spec, c.center);
    const layer = createShapeLayer(shapeLayerName(spec), spec, image, at.x, at.y);
    doc.addLayer(layer, undefined, 'steps.history.add');
    shapeSettings.advance(spec.number);
    sfx.play('layer');
    const screen = app.stage?.docToScreen(c.center.x, c.center.y);
    if (screen) popAt(screen.x, screen.y);
  } catch (error) {
    app.fail(error);
  }
}

/** N: a click puts the next numbered step there; a press on a shape selects it and moves it. */
export const stepTool: ToolController = {
  id: 'step',
  hints: [
    { keys: 'Click', text: 'steps.hint.click' },
    { keys: 'Drag', text: 'steps.hint.drag' },
    { keys: 'Ctrl+Drag', text: 'steps.hint.noSnap' },
    { keys: 'Drag', text: 'steps.hint.move' },
  ],
  cursor(p) {
    if (bodyDragging()) return 'move';
    if (placing || !p) return 'crosshair';
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
    const spec = shapeSettings.stepSpec(shapeSettings.nextNumber());
    placing = { doc, press: p, spec, center: snappedCenter(spec, p.ix, p.iy, p.ctrl), moved: false };
    setCreating(true);
    showDraft(placing);
    sfx.play('tick');
    return true;
  },
  move(p) {
    if (bodyDragging()) {
      moveBodyDrag(p);
      return;
    }
    const c = placing;
    if (!c) return;
    if (!c.moved) {
      if (!leftClick(c.press, p)) return;
      c.moved = true;
    }
    c.center = snappedCenter(c.spec, p.ix, p.iy, p.ctrl);
    showDraft(c);
  },
  up() {
    if (bodyDragging()) {
      endBodyDrag();
      return;
    }
    const c = placing;
    if (c) void commit(c);
  },
  key(e) {
    if (e.key !== 'Escape' || !placing) return false;
    endPlacing();
    sfx.play('cancel');
    return true;
  },
  deactivate() {
    if (placing) endPlacing();
    cancelShapeDrags();
  },
};
