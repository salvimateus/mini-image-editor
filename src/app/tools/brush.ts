import type { CloneSource, StrokeMode } from '../../core/stroke.ts';
import { Stroke } from '../../core/stroke.ts';
import { PARAMS } from '../../core/params/index.ts';
import type { Point, Rect } from '../../core/types.ts';
import { setPaintPointer } from '../../ui/overlays/brush-cursor.ts';
import { showLoupe } from '../../ui/overlays/loupe.ts';
import type { StagePointer } from '../../ui/stage-renderer.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import { t, type TextKey } from '../i18n/index.ts';
import * as sfx from '../sfx.ts';
import { app, type BrushToolId } from '../state.svelte.ts';
import { TUNING } from '../tuning/index.ts';
import { beginPick, cancelPick, endPick, pickMove, pickOnce, type PickSession } from './eyedropper.ts';
import type { Hint, ToolController } from './types.ts';

export interface StrokeToolConfig {
  id: BrushToolId;
  mode: StrokeMode;
  aliased: boolean;
  sound: 'paint' | 'erase' | 'stamp';
  label: TextKey;
  hints: readonly Hint[];
  /** Replaces the Alt+click color pick (the clone stamp sets its source). */
  altPress?(p: StagePointer): void;
  /** The cursor while Alt is held, when altPress replaces the pick. */
  altCursor?: string;
  /** Runs before the stroke starts; null cancels the stroke. Mode 'clone' returns its source. */
  prepare?(doc: EditorDoc, start: Point): CloneSource | null;
  /** The pointer moved (document px), during a hover or a stroke. */
  pointerAt?(point: Point | null): void;
}

/** The shared hints of the brush tools. */
export const SIZE_HINTS: readonly Hint[] = [
  { keys: '[ ]', text: 'paint.hint.size' },
  { keys: 'Shift+[ ]', text: 'paint.hint.hardness' },
];

/** The settings of a brush tool, with the size inside the paint limit. */
export function brushSettings(id: BrushToolId): { size: number; hardness: number; opacity: number } {
  const settings = app.brush[id];
  return { size: Math.min(PARAMS.paint.maxSize, settings.size), hardness: settings.hardness, opacity: settings.opacity };
}

/**
 * A paint tool that drags strokes on the paint target: brush, pencil, eraser, clone stamp. Each stroke is one undo
 * step. Shift+click draws a straight line from the end of the last stroke; Alt+click or a right click picks a color.
 */
export function createStrokeTool(config: StrokeToolConfig): ToolController {
  let stroke: Stroke | null = null;
  let strokeDoc: EditorDoc | null = null;
  let layerId = -1;
  let lastEnd: { doc: EditorDoc; layerId: number; point: Point } | null = null;
  let pick: PickSession | null = null;
  let lastSound = 0;

  function touch(rect: Rect | null): void {
    if (rect && strokeDoc) strokeDoc.touch({ layerId, rect });
  }

  function sound(force: boolean): void {
    const now = performance.now();
    if (!force && now - lastSound < TUNING.paint.strokeSoundMs) return;
    lastSound = now;
    sfx.play(config.sound);
  }

  function finish(): void {
    const current = stroke;
    const doc = strokeDoc;
    stroke = null;
    strokeDoc = null;
    if (!current || !doc) return;
    const end = current.lastPoint;
    const patch = current.end();
    if (end) lastEnd = { doc, layerId, point: end };
    if (!patch || !doc.layer(layerId)) return;
    try {
      doc.commitPatch(layerId, patch, config.label);
    } catch (error) {
      app.fail(error);
    }
  }

  function cancel(): void {
    const current = stroke;
    stroke = null;
    if (!current) return;
    touch(current.cancel());
    strokeDoc = null;
  }

  function start(p: StagePointer): boolean {
    const doc = app.doc;
    if (!doc) return false;
    const point = { x: p.ix, y: p.iy };
    const active = doc.active;
    if (active && active.kind === 'raster' && !active.generator && !active.visible) {
      app.refuse(t('paint.toast.hiddenLayer'));
      return false;
    }
    const line = p.shift && lastEnd && lastEnd.doc === doc && active && lastEnd.layerId === active.id ? lastEnd.point : null;
    let source: CloneSource | null = null;
    if (config.prepare) {
      source = config.prepare(doc, line ?? point);
      if (!source) return false;
    }
    const layer = doc.paintTarget();
    const settings = brushSettings(config.id);
    stroke = new Stroke({
      image: layer.image,
      offset: { x: layer.x, y: layer.y },
      mode: config.mode,
      color: app.fg,
      size: settings.size,
      hardness: config.aliased ? 1 : settings.hardness,
      opacity: settings.opacity,
      aliased: config.aliased,
      selection: doc.selection,
      source,
    });
    strokeDoc = doc;
    layerId = layer.id;
    if (config.mode === 'paint') app.remember(app.fg);
    touch(stroke.addPoints(line ? [line, point] : [point]));
    sound(true);
    return true;
  }

  function track(point: Point | null): void {
    setPaintPointer(point);
    config.pointerAt?.(point);
  }

  return {
    id: config.id,
    hints: config.hints,
    cursor(p) {
      const altMode = !!p?.alt && !stroke && !pick;
      if (altMode && config.altCursor) {
        setPaintPointer(p ? { x: p.ix, y: p.iy } : null, true);
        showLoupe(null);
        return config.altCursor;
      }
      if (altMode && p) {
        setPaintPointer({ x: p.ix, y: p.iy }, true);
        showLoupe({ x: p.ix, y: p.iy });
        return 'crosshair';
      }
      if (!pick) showLoupe(null);
      if (p && !pick) setPaintPointer({ x: p.ix, y: p.iy });
      return 'none';
    },
    down(p) {
      if (!app.doc) return false;
      track({ x: p.ix, y: p.iy });
      if (p.alt) {
        if (config.altPress) {
          config.altPress(p);
          return false;
        }
        pick = beginPick();
        setPaintPointer({ x: p.ix, y: p.iy }, true);
        pickMove(pick, p);
        return true;
      }
      return start(p);
    },
    move(p) {
      if (pick) {
        setPaintPointer({ x: p.ix, y: p.iy }, true);
        pickMove(pick, p);
        return;
      }
      track({ x: p.ix, y: p.iy });
      if (!stroke) return;
      const dirty = stroke.addPoints(p.samples);
      if (dirty) {
        touch(dirty);
        sound(false);
      }
    },
    up(p) {
      if (pick) {
        endPick(pick, p, p.alt);
        pick = null;
        setPaintPointer({ x: p.ix, y: p.iy }, p.alt);
        return;
      }
      finish();
    },
    hover(p) {
      track(p ? { x: p.ix, y: p.iy } : null);
      if (!p) showLoupe(null);
    },
    altClick(p) {
      if (!app.doc) return;
      if (config.altPress) config.altPress(p);
      else pickOnce(p);
    },
    key(e) {
      if (e.key !== 'Escape') return false;
      if (pick) {
        cancelPick(pick);
        pick = null;
        return true;
      }
      if (!stroke) return false;
      cancel();
      sfx.play('cancel');
      return true;
    },
    activate() {
      lastEnd = null;
    },
    deactivate() {
      finish();
      if (pick) endPick(pick, null);
      pick = null;
      track(null);
      showLoupe(null);
    },
  };
}

/** Soft round strokes in the foreground color, with hardness and opacity. */
export const brushTool: ToolController = createStrokeTool({
  id: 'brush',
  mode: 'paint',
  aliased: false,
  sound: 'paint',
  label: 'paint.history.brush',
  hints: [
    { keys: 'Drag', text: 'paint.hint.paint' },
    ...SIZE_HINTS,
    { keys: 'Alt+Click', text: 'paint.hint.pick' },
    { keys: 'Shift+Click', text: 'paint.hint.line' },
  ],
});
