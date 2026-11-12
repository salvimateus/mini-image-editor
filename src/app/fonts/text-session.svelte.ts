import type { Point, RasterImage, Rgba, TextSpec } from '../../core/types.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import { t, type TextKey } from '../i18n/index.ts';
import { createTextLayer } from '../layers.ts';
import * as sfx from '../sfx.ts';
import { app } from '../state.svelte.ts';
import { readStored, writeStored } from '../storage.ts';
import { areaWidth, placeText, placementOf, renderTextNow, renderTextWithStatus, textAnchor, wrappedText } from '../text-render.ts';
import { TUNING } from '../tuning/index.ts';
import { BUNDLED_FAMILY, familyInfo, fitStyle, loadFont, rememberFamily, retryFont } from './fonts.ts';

/** Everything of a text spec except the words, the color and the wrap box: what the next new text starts with. */
export type TextStyle = Omit<TextSpec, 'text' | 'color' | 'boxWidth'>;

/** A text point that has no letters yet. It is not in the document, so an empty text leaves no undo step behind. */
interface Draft {
  readonly session: Session;
  readonly anchor: Point;
  readonly spec: TextSpec;
}

/** One stretch of editing of one text, from its click to the close of the panel or the next text. */
interface Session {
  readonly doc: EditorDoc;
  /** The layer that the session edits; set when the draft becomes a layer. */
  layerId: number | null;
  /** The layer that this session added, so an empty one goes away with its undo steps. */
  createdId: number | null;
}

type Job =
  | { kind: 'render'; session: Session; draft: Draft | null; layerId: number | null; spec: TextSpec; coalesce?: string; anchor?: Point }
  | { kind: 'cleanup'; session: Session };

export type EditTarget = { kind: 'draft'; spec: TextSpec } | { kind: 'layer'; id: number; spec: TextSpec };
export type FontState = 'idle' | 'loading' | 'ready' | 'offline';

const STYLE_KEY = 'text.style';
/** The steps that a session of a new text pushes: its add step and its edits. */
const SESSION_LABELS = new Set<TextKey | null>(['text.history.add', 'history.textEdit']);
/** The most undo steps that the removal of an empty new text walks back. */
const UNDO_GUARD = 200;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function num(value: unknown, fallback: number, range?: { min: number; max: number }): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return range ? clamp(n, range.min, range.max) : n;
}

function color(value: unknown, fallback: Rgba): Rgba {
  if (!value || typeof value !== 'object') return { ...fallback };
  const c = value as Record<string, unknown>;
  const byte = (key: string, base: number) => Math.round(clamp(num(c[key], base), 0, 255));
  return { r: byte('r', fallback.r), g: byte('g', fallback.g), b: byte('b', fallback.b), a: byte('a', fallback.a) };
}

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A style with each field checked and clamped; a missing or broken field takes the default. */
export function cleanStyle(value: Partial<Record<keyof TextStyle, unknown>>): TextStyle {
  const d = TUNING.text.defaults;
  const r = TUNING.text.ranges;
  const stroke = (value.stroke ?? {}) as Record<string, unknown>;
  const shadow = (value.shadow ?? {}) as Record<string, unknown>;
  return {
    family: typeof value.family === 'string' && value.family ? value.family : d.family,
    weight: Math.round(num(value.weight, d.weight, { min: 1, max: 1000 })),
    italic: typeof value.italic === 'boolean' ? value.italic : d.italic,
    size: num(value.size, d.size, { min: 1, max: 4000 }),
    letterSpacing: num(value.letterSpacing, d.letterSpacing, { min: -4000, max: 4000 }),
    lineHeight: num(value.lineHeight, d.lineHeight, r.lineHeight),
    align: pick(value.align, ['left', 'center', 'right'] as const, d.align),
    transform: pick(value.transform, ['none', 'upper', 'lower', 'capitalize'] as const, d.transform),
    stroke: {
      on: typeof stroke.on === 'boolean' ? stroke.on : d.stroke.on,
      color: color(stroke.color, d.stroke.color),
      width: num(stroke.width, d.stroke.width, { min: 0, max: 4000 }),
    },
    shadow: {
      on: typeof shadow.on === 'boolean' ? shadow.on : d.shadow.on,
      color: color(shadow.color, d.shadow.color),
      blur: num(shadow.blur, d.shadow.blur, { min: 0, max: 4000 }),
      dx: num(shadow.dx, d.shadow.dx, { min: -4000, max: 4000 }),
      dy: num(shadow.dy, d.shadow.dy, { min: -4000, max: 4000 }),
    },
  };
}

function loadStyle(): TextStyle {
  const text = readStored(STYLE_KEY);
  if (!text) return cleanStyle({});
  try {
    const value: unknown = JSON.parse(text);
    return cleanStyle(value && typeof value === 'object' ? (value as Partial<Record<keyof TextStyle, unknown>>) : {});
  } catch {
    return cleanStyle({});
  }
}

function styleOf(spec: TextSpec): TextStyle {
  const { text: _text, color: _color, boxWidth: _box, ...style } = spec;
  return cleanStyle(style);
}

/** A wrap width in whole px, at least the minimum; null for a free text. */
function cleanBox(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const { min, max } = TUNING.text.ranges.boxWidth;
  return Math.round(clamp(value, min, max));
}

function withStyle(style: TextStyle, text: string, fill: Rgba): TextSpec {
  return { ...cleanStyle(style), text, color: { ...fill } };
}

function sameSpec(a: TextSpec, b: TextSpec): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameImage(a: RasterImage, b: RasterImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  const x = a.data;
  const y = b.data;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** A patch of a spec; stroke and shadow merge field by field. */
export interface SpecPatch extends Partial<Omit<TextSpec, 'stroke' | 'shadow'>> {
  stroke?: Partial<TextSpec['stroke']>;
  shadow?: Partial<TextSpec['shadow']>;
}

function applyPatch(spec: TextSpec, patch: SpecPatch): TextSpec {
  const merged = {
    ...spec,
    ...patch,
    stroke: { ...spec.stroke, ...patch.stroke },
    shadow: { ...spec.shadow, ...patch.shadow },
  };
  const out = withStyle(cleanStyle(merged), typeof merged.text === 'string' ? merged.text : '', color(merged.color, spec.color));
  out.boxWidth = cleanBox(merged.boxWidth);
  return out;
}

/**
 * The text that the Text panel and the text tool edit: a draft (a new text point with no letters) or the active text
 * layer. Edits render in order, the newest edit of one text wins, and each render goes to the document as one
 * coalesced undo step that keeps the anchor of the text in place.
 */
class TextSession {
  draft = $state.raw<Draft | null>(null);
  /** The style of the next new text; it follows the last edit. */
  style = $state.raw<TextStyle>(loadStyle());
  /** The newest spec of a layer whose render is not in the document yet, so the fields do not jump back. */
  pending = $state.raw<{ id: number; spec: TextSpec } | null>(null);
  /** The load state of the font of the edited text. */
  font = $state<FontState>('idle');
  /** The Text panel puts the focus in its text field when this changes. */
  focusTick = $state(0);

  private current: Session | null = null;
  private jobs: Job[] = [];
  private running = false;

  /** The draft of the open document, else its active text layer, else null. */
  get target(): EditTarget | null {
    const doc = app.doc;
    if (!doc) return null;
    const draft = this.draft;
    if (draft && draft.session.doc === doc) return { kind: 'draft', spec: draft.spec };
    const layer = doc.active;
    if (!layer || layer.kind !== 'text') return null;
    const pending = this.pending;
    return { kind: 'layer', id: layer.id, spec: pending && pending.id === layer.id ? pending.spec : layer.spec };
  }

  /** A new spec with the last used style and the foreground color. */
  newSpec(): TextSpec {
    return withStyle(this.style, '', app.fg);
  }

  /** The spec that the controls show: the edited text, or the style of the next text. */
  get shown(): TextSpec {
    return this.target?.spec ?? this.newSpec();
  }

  /** A new family, with the nearest weight it has and italic only where it exists. */
  setFamily(family: string): void {
    const base = this.shown;
    const info = familyInfo(family);
    this.update({ family, ...(info ? fitStyle(info, base.weight, base.italic) : {}) });
  }

  setWeight(weight: number): void {
    const base = this.shown;
    const info = familyInfo(base.family);
    this.update(info ? fitStyle(info, weight, base.italic) : { weight });
  }

  setItalic(italic: boolean): void {
    const base = this.shown;
    const info = familyInfo(base.family);
    this.update(info ? fitStyle(info, base.weight, italic) : { italic });
  }

  /**
   * A new text at `point` (document px): a free text, or an area text that wraps at `boxWidth` with its box top-left
   * at the point. The text joins the document with its first letter.
   */
  begin(point: Point, boxWidth: number | null = null): void {
    const doc = app.doc;
    if (!doc) return;
    this.end();
    const session: Session = { doc, layerId: null, createdId: null };
    this.current = session;
    const spec = this.newSpec();
    spec.boxWidth = cleanBox(boxWidth);
    this.draft = { session, anchor: { x: Math.round(point.x), y: Math.round(point.y) }, spec };
    this.font = 'idle';
    this.openPanel();
  }

  /** Makes the text layer active and opens it in the Text panel. */
  edit(id: number): void {
    const doc = app.doc;
    const layer = doc?.layer(id);
    if (!doc || !layer || layer.kind !== 'text') return;
    if (this.draft) this.end();
    doc.setActive(id);
    this.follow();
    this.openPanel();
  }

  /** Starts a session for the active text layer when it is not the one of the current session. */
  follow(): void {
    const target = this.target;
    if (!target || target.kind !== 'layer') return;
    if (this.current && this.current.layerId === target.id && this.current.doc === app.doc) return;
    const doc = app.doc;
    if (!doc) return;
    this.end();
    this.current = { doc, layerId: target.id, createdId: null };
  }

  /** Ends the session: an empty draft goes away, and so does a text layer that has no letters. */
  end(): void {
    const draft = this.draft;
    if (draft && !draft.spec.text) {
      this.draft = null;
      this.dropJobsOf(draft);
    }
    const session = this.current;
    this.current = null;
    if (!session) return;
    this.jobs.push({ kind: 'cleanup', session });
    void this.pump();
  }

  /**
   * Changes the edited text, or the style of the next text when nothing is edited. `anchor` (document px) places the
   * text box anew, for a handle that moves the left side of an area text.
   */
  update(patch: SpecPatch, coalesce?: string, anchor?: Point): void {
    const target = this.target;
    if (!target) {
      this.setStyle(patch);
      return;
    }
    const spec = applyPatch(target.spec, patch);
    this.rememberStyle(spec);
    if (patch.family !== undefined && patch.family !== target.spec.family) rememberFamily(spec.family);
    if (target.kind === 'draft') {
      const draft = this.draft;
      if (!draft) return;
      const next: Draft = { ...draft, spec };
      this.draft = next;
      this.dropJobsOf(draft);
      if (spec.text) this.enqueue({ kind: 'render', session: draft.session, draft: next, layerId: null, spec, coalesce });
      else if (patch.family !== undefined) this.warm(spec);
      return;
    }
    this.follow();
    const session = this.current;
    if (!session) return;
    this.pending = { id: target.id, spec };
    this.enqueue({ kind: 'render', session, draft: null, layerId: target.id, spec, coalesce, anchor });
  }

  /**
   * Free text or area text. A free text becomes an area text as wide as its lines; an area text becomes a free text
   * with the line breaks that the wrap made.
   */
  setArea(on: boolean): void {
    const target = this.target;
    if (!target || (areaWidth(target.spec) !== null) === on) return;
    if (!on) {
      this.update({ boxWidth: null, text: wrappedText(target.spec) });
      return;
    }
    let width: number = TUNING.text.defaultBoxWidth;
    if (target.kind === 'layer') {
      const layer = app.doc?.layer(target.id);
      if (layer?.kind === 'text' && layer.spec.text) width = Math.ceil(placementOf(layer.image, layer.spec).boxW);
    }
    this.update({ boxWidth: Math.max(width, TUNING.text.ranges.boxWidth.min) });
  }

  /** The style of the next new text, with no edited text. */
  setStyle(patch: SpecPatch): void {
    const spec = applyPatch(withStyle(this.style, '', app.fg), patch);
    this.rememberStyle(spec);
    if (patch.family !== undefined) {
      rememberFamily(spec.family);
      this.warm(spec);
    }
    if (patch.color) app.setFg(spec.color);
  }

  /** Asks the network again for the font of the edited text, and renders the text again. */
  retry(): void {
    const target = this.target;
    const spec = target?.spec ?? withStyle(this.style, '', app.fg);
    retryFont(spec.family);
    if (target?.kind === 'layer') this.update({});
    else this.warm(spec);
  }

  /** Loads the font of a spec that has no text to render yet, for the state of the picker. */
  private warm(spec: TextSpec): void {
    this.font = 'loading';
    const family = spec.family;
    void loadFont(family, spec.weight, spec.italic).then((status) => {
      const now = this.target?.spec.family ?? this.style.family;
      if (now === family) this.font = family === BUNDLED_FAMILY ? 'ready' : status;
    });
  }

  private openPanel(): void {
    if (app.panel !== 'text') app.openPanel('text');
    this.focusTick += 1;
  }

  private rememberStyle(spec: TextSpec): void {
    const style = styleOf(spec);
    this.style = style;
    writeStored(STYLE_KEY, JSON.stringify(style));
  }

  private dropJobsOf(draft: Draft): void {
    this.jobs = this.jobs.filter((job) => job.kind !== 'render' || job.draft === null || job.draft.session !== draft.session || job.layerId !== null);
  }

  /** Queues a render; it replaces a queued render of the same text, so only the newest one runs. */
  private enqueue(job: Extract<Job, { kind: 'render' }>): void {
    const last = this.jobs[this.jobs.length - 1];
    const sameText = last && last.kind === 'render' && last.session === job.session && last.layerId === job.layerId && (last.draft === null) === (job.draft === null);
    if (sameText) this.jobs[this.jobs.length - 1] = job;
    else this.jobs.push(job);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.jobs.length) {
        const job = this.jobs.shift() as Job;
        if (job.kind === 'cleanup') this.cleanup(job.session);
        else await this.render(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async render(job: Extract<Job, { kind: 'render' }>): Promise<void> {
    let image = renderTextNow(job.spec);
    if (image) {
      this.font = 'ready';
    } else {
      this.font = 'loading';
      const result = await renderTextWithStatus(job.spec);
      image = result.image;
      this.font = job.spec.family === BUNDLED_FAMILY ? 'ready' : result.status;
      // A newer edit of the same text waits in the queue: this render is stale.
      const next = this.jobs[0];
      if (next && next.kind === 'render' && next.session === job.session && next.layerId === job.layerId) return;
    }
    const doc = job.session.doc;
    if (app.doc !== doc) return;
    try {
      if (job.draft) {
        const at = placeText(job.draft.anchor, image, job.spec);
        const layer = createTextLayer(t('text.layerName'), job.spec, image, at.x, at.y);
        doc.addLayer(layer, undefined, 'text.history.add');
        job.session.layerId = layer.id;
        job.session.createdId = layer.id;
        if (this.draft?.session === job.session) this.draft = null;
        // Later edits of this text in the queue now go to the new layer.
        for (const entry of this.jobs) {
          if (entry.kind !== 'render' || entry.session !== job.session || !entry.draft) continue;
          Object.assign(entry, { draft: null, layerId: layer.id });
          this.pending = { id: layer.id, spec: entry.spec };
        }
        sfx.play('layer');
        return;
      }
      const id = job.layerId;
      const layer = id === null ? null : doc.layer(id);
      if (id === null || !layer || layer.kind !== 'text') return;
      if (sameSpec(layer.spec, job.spec) && sameImage(layer.image, image)) return;
      // An alignment change keeps the side of the box that the new alignment names, so the text does not jump.
      const anchor = job.anchor ?? textAnchor(layer, job.spec.align, areaWidth(job.spec) !== null);
      const at = placeText(anchor, image, job.spec);
      doc.setTextSpec(id, job.spec, image, job.coalesce, at);
    } catch (error) {
      app.fail(error);
    } finally {
      const pending = this.pending;
      if (pending && pending.id === job.layerId && !this.jobs.some((entry) => entry.kind === 'render' && entry.layerId === pending.id)) this.pending = null;
    }
  }

  /** An empty text layer goes away. A layer that this session added leaves with its own undo steps. */
  private cleanup(session: Session): void {
    const doc = session.doc;
    const id = session.layerId;
    if (app.doc !== doc || id === null) return;
    const layer = doc.layer(id);
    if (!layer || layer.kind !== 'text' || layer.spec.text) return;
    if (session.createdId === id) {
      for (let guard = 0; guard < UNDO_GUARD && doc.layer(id) && SESSION_LABELS.has(doc.history.undoLabel); guard++) doc.undo();
    }
    if (doc.layer(id)) doc.removeLayer(id);
  }
}

export const textSession = new TextSession();
