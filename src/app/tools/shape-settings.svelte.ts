import { untrack } from 'svelte';
import { fromHex } from '../../core/color.ts';
import type { Point, Rgba, ShapeSpec, StrokeStyle } from '../../core/types.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import type { ShapeLayer } from '../layers.ts';
import { renderShapeLayer, shapeOrigin } from '../shape-render.ts';
import { app } from '../state.svelte.ts';
import { onPrefsReset, readPrefs, savePrefs } from '../prefs.ts';
import { TUNING } from '../tuning/index.ts';

/** What the Shapes tool draws next. */
export type ShapeKindId = 'rect' | 'ellipse' | 'thin' | 'thick';
export const SHAPE_KINDS: readonly ShapeKindId[] = ['rect', 'ellipse', 'thin', 'thick'];

/** Rectangle and ellipse. */
export interface BoxSettings { stroke: StrokeStyle; fillOn: boolean; fill: Rgba; radius: number }
export interface ArrowSettings { color: Rgba; thinSize: number; thickSize: number; stroke: StrokeStyle }
export interface StepSettings { size: number; fill: Rgba; textColor: Rgba; stroke: StrokeStyle; shadow: boolean }
export interface ShapeSettings { kind: ShapeKindId; box: BoxSettings; arrow: ArrowSettings; step: StepSettings }

type StepSpec = Extract<ShapeSpec, { kind: 'step' }>;

const STORE_KEY = 'shapes.settings';
const STORE_VERSION = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function num(value: unknown, fallback: number, range: { min: number; max: number }): number {
  return clamp(typeof value === 'number' && Number.isFinite(value) ? value : fallback, range.min, range.max);
}

function hex(text: string): Rgba {
  return fromHex(text) ?? { r: 255, g: 0, b: 0, a: 255 };
}

function color(value: unknown, fallback: string): Rgba {
  const base = hex(fallback);
  if (!value || typeof value !== 'object') return base;
  const c = value as Record<string, unknown>;
  const byte = (key: 'r' | 'g' | 'b' | 'a') => Math.round(num(c[key], base[key], { min: 0, max: 255 }));
  return { r: byte('r'), g: byte('g'), b: byte('b'), a: byte('a') };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stroke(value: unknown, fallbackColor: string, fallbackWidth: number, range: { min: number; max: number }): StrokeStyle {
  const s = record(value);
  return { color: color(s.color, fallbackColor), width: Math.round(num(s.width, fallbackWidth, range)) };
}

/** Settings with each field checked and clamped; a missing or broken field takes the default. */
function cleanSettings(value: unknown): ShapeSettings {
  const d = TUNING.shapes.defaults;
  const r = TUNING.shapes.ranges;
  const v = record(value);
  const box = record(v.box);
  const arrow = record(v.arrow);
  const step = record(v.step);
  return {
    kind: typeof v.kind === 'string' && (SHAPE_KINDS as readonly string[]).includes(v.kind) ? (v.kind as ShapeKindId) : d.kind,
    box: {
      stroke: stroke(box.stroke, d.box.strokeColor, d.box.strokeWidth, r.strokeWidth),
      fillOn: typeof box.fillOn === 'boolean' ? box.fillOn : d.box.fillOn,
      fill: color(box.fill, d.box.fillColor),
      radius: Math.round(num(box.radius, d.box.radius, r.radius)),
    },
    arrow: {
      color: color(arrow.color, d.arrow.color),
      thinSize: Math.round(num(arrow.thinSize, d.arrow.thinSize, r.thinSize)),
      thickSize: Math.round(num(arrow.thickSize, d.arrow.thickSize, r.thickSize)),
      stroke: stroke(arrow.stroke, d.arrow.strokeColor, d.arrow.strokeWidth, r.strokeWidth),
    },
    step: {
      size: Math.round(num(step.size, d.step.size, r.stepSize)),
      fill: color(step.fill, d.step.fill),
      textColor: color(step.textColor, d.step.textColor),
      stroke: stroke(step.stroke, d.step.strokeColor, d.step.strokeWidth, r.stepStroke),
      shadow: typeof step.shadow === 'boolean' ? step.shadow : d.step.shadow,
    },
  };
}

function loadSettings(): ShapeSettings {
  return cleanSettings(readPrefs(STORE_KEY, STORE_VERSION) ?? {});
}

/** The kind id of a shape spec, or 'step'. */
export function kindOf(spec: ShapeSpec): ShapeKindId | 'step' {
  if (spec.kind === 'arrow') return spec.style;
  return spec.kind;
}

export function isArrowKind(kind: ShapeKindId): kind is 'thin' | 'thick' {
  return kind === 'thin' || kind === 'thick';
}

function sameFamily(a: ShapeKindId, b: ShapeKindId): boolean {
  return isArrowKind(a) === isArrowKind(b);
}

function sameSpec(a: ShapeSpec, b: ShapeSpec): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The settings of the Shapes and Steps tools, the number of the next step, and the live edit of the active shape. */
class ShapeSettingsStore {
  value = $state.raw<ShapeSettings>(loadSettings());
  /** A next step number that the user typed, for one document; null = the largest step number plus 1. */
  private typed = $state.raw<{ doc: EditorDoc; value: number } | null>(null);

  private patch(update: (settings: ShapeSettings) => ShapeSettings): void {
    this.value = cleanSettings(update(this.value));
    savePrefs(STORE_KEY, STORE_VERSION, this.value);
  }

  /** The defaults of every setting; the typed step number stays, it belongs to the document. */
  resetSettings(): void {
    this.value = cleanSettings({});
  }

  // ----- the active shape -----

  /** The active shape layer that the options of `tool` edit: a rectangle or an ellipse, an arrow, or a step. */
  activeFor(tool: 'shape' | 'step'): ShapeLayer | null {
    const layer = app.doc?.active;
    if (!layer || layer.kind !== 'shape') return null;
    const kind = kindOf(layer.spec);
    if (tool === 'step') return kind === 'step' ? layer : null;
    return kind !== 'step' && sameFamily(kind, this.value.kind) ? layer : null;
  }

  /** Renders the edited spec and puts it in the document; the spec origin (top-left, tail or center) stays in place. */
  private applyTo(layer: ShapeLayer, next: ShapeSpec, coalesce?: string): void {
    const doc = app.doc;
    if (!doc || sameSpec(layer.spec, next)) return;
    try {
      const image = renderShapeLayer(next);
      const before = shapeOrigin(layer.spec);
      const after = shapeOrigin(next);
      const at: Point = { x: layer.x + before.x - after.x, y: layer.y + before.y - after.y };
      doc.setShapeSpec(layer.id, next, image, coalesce, at);
    } catch (error) {
      app.fail(error);
    }
  }

  private editActive(tool: 'shape' | 'step', edit: (spec: ShapeSpec) => ShapeSpec | null, coalesce?: string): void {
    const layer = this.activeFor(tool);
    if (!layer) return;
    const next = edit(layer.spec);
    if (next) this.applyTo(layer, next, coalesce);
  }

  // ----- Shapes options -----

  /** The kind of the next shape. It never changes the active shape: users often draw several kinds in a row. */
  setKind(kind: ShapeKindId): void {
    this.patch((s) => ({ ...s, kind }));
  }

  /** The kind follows a shape layer that becomes active, so the options show it. */
  followKind(spec: ShapeSpec): void {
    const kind = kindOf(spec);
    if (kind === 'step' || kind === this.value.kind) return;
    this.patch((s) => ({ ...s, kind }));
  }

  setStroke(change: Partial<StrokeStyle>, coalesce?: string): void {
    const arrow = isArrowKind(this.value.kind);
    this.patch((s) => (arrow ? { ...s, arrow: { ...s.arrow, stroke: { ...s.arrow.stroke, ...change } } } : { ...s, box: { ...s.box, stroke: { ...s.box.stroke, ...change } } }));
    this.editActive('shape', (spec) => (spec.kind === 'step' ? null : { ...spec, stroke: { ...spec.stroke, ...change } }), coalesce);
  }

  setFillOn(on: boolean): void {
    this.patch((s) => ({ ...s, box: { ...s.box, fillOn: on } }));
    const fill = this.value.box.fill;
    this.editActive('shape', (spec) => (spec.kind === 'rect' || spec.kind === 'ellipse' ? { ...spec, fill: on ? { ...(spec.fill ?? fill) } : null } : null));
  }

  setFillColor(next: Rgba): void {
    this.patch((s) => ({ ...s, box: { ...s.box, fill: next, fillOn: true } }));
    this.editActive('shape', (spec) => (spec.kind === 'rect' || spec.kind === 'ellipse' ? { ...spec, fill: { ...next } } : null));
  }

  setRadius(radius: number, coalesce?: string): void {
    this.patch((s) => ({ ...s, box: { ...s.box, radius } }));
    this.editActive('shape', (spec) => (spec.kind === 'rect' ? { ...spec, radius: this.value.box.radius } : null), coalesce);
  }

  setArrowColor(next: Rgba): void {
    this.patch((s) => ({ ...s, arrow: { ...s.arrow, color: next } }));
    this.editActive('shape', (spec) => (spec.kind === 'arrow' ? { ...spec, fill: { ...next } } : null));
  }

  setArrowSize(size: number, coalesce?: string): void {
    const thin = this.value.kind === 'thin';
    this.patch((s) => ({ ...s, arrow: thin ? { ...s.arrow, thinSize: size } : { ...s.arrow, thickSize: size } }));
    const clean = thin ? this.value.arrow.thinSize : this.value.arrow.thickSize;
    this.editActive('shape', (spec) => (spec.kind === 'arrow' ? { ...spec, size: clean } : null), coalesce);
  }

  // ----- Steps options -----

  setStep(change: Partial<Omit<StepSettings, 'stroke'>> & { stroke?: Partial<StrokeStyle> }, coalesce?: string): void {
    this.patch((s) => ({ ...s, step: { ...s.step, ...change, stroke: { ...s.step.stroke, ...change.stroke } } }));
    const step = this.value.step;
    this.editActive(
      'step',
      (spec) =>
        spec.kind === 'step'
          ? {
              ...spec,
              size: change.size !== undefined ? step.size : spec.size,
              fill: change.fill ? { ...step.fill } : spec.fill,
              textColor: change.textColor ? { ...step.textColor } : spec.textColor,
              stroke: change.stroke ? { ...spec.stroke, ...change.stroke } : spec.stroke,
              shadow: change.shadow !== undefined ? step.shadow : spec.shadow,
            }
          : null,
      coalesce,
    );
  }

  /** The largest step number in the document, or 0. */
  private largestStep(doc: EditorDoc): number {
    let most = 0;
    for (const layer of doc.layers) {
      if (layer.kind === 'shape' && layer.spec.kind === 'step') most = Math.max(most, layer.spec.number);
    }
    return most;
  }

  /** The number of the next step: the typed one, else the largest step number plus 1. */
  nextNumber(): number {
    const doc = app.doc;
    if (!doc) return 1;
    const typed = this.typed;
    if (typed && typed.doc === doc) return typed.value;
    return this.largestStep(doc) + 1;
  }

  setNextNumber(value: number): void {
    const doc = app.doc;
    if (!doc) return;
    const range = TUNING.shapes.ranges.stepNumber;
    this.typed = { doc, value: Math.round(clamp(value, range.min, range.max)) };
  }

  restartNumbers(): void {
    this.setNextNumber(1);
  }

  /** After a step with `placed`: a typed next number grows by 1; the automatic one grows by itself. */
  advance(placed: number): void {
    const typed = this.typed;
    if (typed && typed.doc === app.doc) this.setNextNumber(placed + 1);
  }

  // ----- new specs -----

  /** A rectangle or an ellipse of the current settings. */
  boxSpec(kind: 'rect' | 'ellipse', w: number, h: number): ShapeSpec {
    const b = this.value.box;
    const fill = b.fillOn ? { ...b.fill } : null;
    const strokeStyle = { color: { ...b.stroke.color }, width: b.stroke.width };
    return kind === 'rect' ? { kind, w, h, radius: b.radius, stroke: strokeStyle, fill } : { kind, w, h, stroke: strokeStyle, fill };
  }

  arrowSpec(style: 'thin' | 'thick', dx: number, dy: number): ShapeSpec {
    const a = this.value.arrow;
    return { kind: 'arrow', dx, dy, style, size: style === 'thin' ? a.thinSize : a.thickSize, fill: { ...a.color }, stroke: { color: { ...a.stroke.color }, width: a.stroke.width } };
  }

  stepSpec(number: number): StepSpec {
    const s = this.value.step;
    return { kind: 'step', number, size: s.size, fill: { ...s.fill }, textColor: { ...s.textColor }, stroke: { color: { ...s.stroke.color }, width: s.stroke.width }, shadow: s.shadow };
  }
}

export const shapeSettings = new ShapeSettingsStore();
onPrefsReset(() => shapeSettings.resetSettings());

// The options follow the active shape layer, and the handles redraw when another layer becomes active.
let followed: { doc: EditorDoc; id: number | null } | null = null;

$effect.root(() => {
  $effect(() => {
    const doc = app.doc;
    const id = doc?.activeId ?? null;
    untrack(() => {
      if (doc && (followed?.doc !== doc || followed.id !== id)) {
        followed = { doc, id };
        const layer = doc.active;
        if (layer?.kind === 'shape') shapeSettings.followKind(layer.spec);
      }
      app.stage?.invalidateFx();
    });
  });
});
