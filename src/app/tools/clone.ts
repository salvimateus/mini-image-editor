import { paintSource } from '../../core/fill.ts';
import type { Point } from '../../core/types.ts';
import { setCloneMarker } from '../../ui/overlays/brush-cursor.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import { t } from '../i18n/index.ts';
import * as sfx from '../sfx.ts';
import { app } from '../state.svelte.ts';
import { createStrokeTool, SIZE_HINTS } from './brush.ts';
import type { ToolController } from './types.ts';

/**
 * The source point of the clone stamp (document px) and, after the first stroke, the aligned offset from the stroke
 * to the source. Both belong to one document.
 */
interface CloneState { doc: EditorDoc; source: Point; offset: Point | null }

let state: CloneState | null = null;
const listeners = new Set<(hasSource: boolean) => void>();

function current(): CloneState | null {
  return state && state.doc === app.doc ? state : null;
}

function notify(): void {
  const has = current() !== null;
  for (const listener of [...listeners]) listener(has);
}

/** Calls `listener` now and on each change of the source; returns the cleanup. */
export function watchCloneSource(listener: (hasSource: boolean) => void): () => void {
  listeners.add(listener);
  listener(current() !== null);
  return () => {
    listeners.delete(listener);
  };
}

export function clearCloneSource(): void {
  if (!state) return;
  state = null;
  setCloneMarker(null);
  sfx.play('tick');
  notify();
}

function setSource(point: Point): void {
  const doc = app.doc;
  if (!doc) return;
  const fresh = !current();
  state = { doc, source: { x: Math.floor(point.x) + 0.5, y: Math.floor(point.y) + 0.5 }, offset: null };
  setCloneMarker(state.source);
  sfx.play('pick');
  if (fresh) app.toast(t('paint.toast.sourceSet'), 'info');
  notify();
}

/** Before the first stroke the cross stays on the source; then it follows the pointer at the aligned offset. */
function markerFor(point: Point | null): Point | null {
  const clone = current();
  if (!clone) return null;
  if (!clone.offset) return clone.source;
  return point ? { x: point.x + clone.offset.x, y: point.y + clone.offset.y } : null;
}

/** Alt+click or a right click sets the source; a stroke copies the visible layers (no generated layers), aligned to the source offset. */
export const cloneTool: ToolController = createStrokeTool({
  id: 'clone',
  mode: 'clone',
  aliased: false,
  sound: 'stamp',
  label: 'paint.history.clone',
  hints: [
    { keys: 'Alt+Click', text: 'paint.hint.cloneSource' },
    { keys: 'Drag', text: 'paint.hint.cloneDrag' },
    ...SIZE_HINTS,
    { keys: 'Shift+Click', text: 'paint.hint.line' },
  ],
  altPress: (p) => setSource({ x: p.ix, y: p.iy }),
  altCursor: 'crosshair',
  prepare(doc, start) {
    const clone = current();
    if (!clone) {
      app.refuse(t('paint.toast.noSource'));
      return null;
    }
    if (!clone.offset) {
      clone.offset = { x: Math.round(clone.source.x - start.x), y: Math.round(clone.source.y - start.y) };
    }
    return { image: paintSource(doc.width, doc.height, doc.layers), dx: clone.offset.x, dy: clone.offset.y };
  },
  pointerAt(point) {
    setCloneMarker(markerFor(point));
  },
});
