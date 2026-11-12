import { flatten as flattenLayers, sampleComposite, type FlatLayer } from '../core/composite.ts';
import { translateMask, type Mask } from '../core/mask.ts';
import { cloneRaster, createRaster, intersectRect, readRect, unionRect, writeRect } from '../core/raster.ts';
import type { Patch, Point, RasterImage, Rect, Rgba, ShapeSpec, TextSpec } from '../core/types.ts';
import { History, type HistoryEntry } from './history.svelte.ts';
import { t, type TextKey } from './i18n/index.ts';
import { cloneShapeSpec, cloneTextSpec, createRasterLayer, isRenderedLayer, layerRect, type Layer, type LayerBase, type RasterLayer } from './layers.ts';

export interface Guide { readonly id: number; axis: 'x' | 'y'; pos: number }

export interface GridSpec { mode: 'spacing' | 'divisions'; spacing: number; cols: number; rows: number }

/** rect in layer px; scale 1 = full resolution. The scene draws it in place of that part of the layer. */
export interface LayerPreview { layerId: number; image: RasterImage; rect: Rect; scale: number }

/** rect in layer px; null = the whole layer. */
export interface DocChange { layerId: number; rect: Rect | null }

export type LayerProps = Partial<Pick<LayerBase, 'name' | 'visible' | 'opacity' | 'x' | 'y'>>;

export const DEFAULT_GRID: GridSpec = { mode: 'spacing', spacing: 32, cols: 3, rows: 3 };

type Recorded = { label: TextKey; bytes: number; coalesce?: string; neutral?: boolean; undo(): void; redo(): void };

function propsLabel(patch: LayerProps): TextKey {
  const keys = Object.keys(patch);
  if (keys.length === 1) {
    if (keys[0] === 'name') return 'history.renameLayer';
    if (keys[0] === 'visible') return 'history.layerVisibility';
    if (keys[0] === 'opacity') return 'history.layerOpacity';
  }
  if (keys.every((key) => key === 'x' || key === 'y')) return 'history.layerPosition';
  return 'history.edit';
}

function cleanProps(patch: LayerProps): LayerProps {
  const out: LayerProps = {};
  if (patch.name !== undefined) out.name = patch.name;
  if (patch.visible !== undefined) out.visible = patch.visible;
  if (patch.opacity !== undefined) out.opacity = Math.min(1, Math.max(0, patch.opacity));
  if (patch.x !== undefined) out.x = Math.round(patch.x);
  if (patch.y !== undefined) out.y = Math.round(patch.y);
  return out;
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * The open document: layers bottom first, selection, guides and the undo history. Layer objects are replaced, never
 * changed, except the pixels of a layer image, which commitPatch writes in place.
 */
export class EditorDoc {
  #width = $state(0);
  #height = $state(0);
  #layers = $state.raw<readonly Layer[]>([]);
  #activeId = $state<number | null>(null);
  #selection = $state.raw<Mask | null>(null);
  #guides = $state.raw<readonly Guide[]>([]);
  #grid = $state.raw<GridSpec>(DEFAULT_GRID);
  #preview = $state.raw<LayerPreview | null>(null);
  #version = $state(0);
  name = $state('');
  sourceBytes = $state<number | null>(null);
  readonly history = new History();

  private readonly listeners = new Set<(change: DocChange | null) => void>();
  private batchParts: Recorded[] | null = null;
  private quiet = 0;
  private quietChanged = false;
  private lastGuideId = 0;
  private layerCounter = 0;

  constructor(init: { width: number; height: number; name: string; layers: Layer[]; sourceBytes?: number | null }) {
    this.#width = Math.max(1, Math.round(init.width));
    this.#height = Math.max(1, Math.round(init.height));
    this.name = init.name;
    this.sourceBytes = init.sourceBytes ?? null;
    this.#layers = [...init.layers];
    this.layerCounter = init.layers.length;
    this.#activeId = init.layers.length ? init.layers[init.layers.length - 1].id : null;
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  get layers(): readonly Layer[] {
    return this.#layers;
  }

  get activeId(): number | null {
    return this.#activeId;
  }

  get selection(): Mask | null {
    return this.#selection;
  }

  get guides(): readonly Guide[] {
    return this.#guides;
  }

  get grid(): GridSpec {
    return this.#grid;
  }

  get preview(): LayerPreview | null {
    return this.#preview;
  }

  get version(): number {
    return this.#version;
  }

  get active(): Layer | null {
    return this.#activeId === null ? null : this.layer(this.#activeId);
  }

  layer(id: number): Layer | null {
    return this.#layers.find((layer) => layer.id === id) ?? null;
  }

  indexOf(id: number): number {
    return this.#layers.findIndex((layer) => layer.id === id);
  }

  /** A new guide id, unique in this document. */
  nextGuideId(): number {
    this.lastGuideId += 1;
    return this.lastGuideId;
  }

  /** The default name of the next new layer ('Layer 2'). */
  nextLayerName(): string {
    this.layerCounter += 1;
    return t('doc.layerName', { n: this.layerCounter });
  }

  setActive(id: number | null): void {
    const next = id !== null && this.layer(id) ? id : null;
    if (next === this.#activeId) return;
    this.#activeId = next;
  }

  // ----- history -----

  /** Undoes one step. The listeners get one null change. */
  undo(): HistoryEntry | null {
    return this.quietly(() => this.history.undo());
  }

  redo(): HistoryEntry | null {
    return this.quietly(() => this.history.redo());
  }

  /** The changes inside `run` are one undo step. If `run` throws, its changes are undone and the error goes on. */
  batch(label: TextKey, run: () => void): void {
    if (this.batchParts) {
      run();
      return;
    }
    const parts: Recorded[] = [];
    this.batchParts = parts;
    try {
      run();
    } catch (error) {
      this.batchParts = null;
      this.quietly(() => {
        for (let i = parts.length - 1; i >= 0; i--) parts[i].undo();
      });
      throw error;
    }
    this.batchParts = null;
    if (!parts.length) return;
    if (parts.length === 1) {
      this.history.push({ ...parts[0], label });
      return;
    }
    let bytes = 0;
    for (const part of parts) bytes += part.bytes;
    this.history.push({
      label,
      bytes,
      neutral: parts.every((part) => part.neutral),
      undo: () => {
        for (let i = parts.length - 1; i >= 0; i--) parts[i].undo();
      },
      redo: () => {
        for (const part of parts) part.redo();
      },
    });
  }

  /** Runs `redo` now and records the step. */
  private record(entry: Recorded): void {
    entry.redo();
    if (this.batchParts) this.batchParts.push(entry);
    else this.history.push(entry);
  }

  private quietly<T>(run: () => T): T {
    this.quiet += 1;
    try {
      return run();
    } finally {
      this.quiet -= 1;
      if (this.quiet === 0 && this.quietChanged) {
        this.quietChanged = false;
        this.#preview = null;
        this.touch();
      }
    }
  }

  // ----- change events -----

  /** Version + 1 and tells the listeners. No change = everything changed. */
  touch(change?: DocChange): void {
    if (this.quiet > 0) {
      this.quietChanged = true;
      return;
    }
    this.#version += 1;
    const value = change ?? null;
    for (const listener of [...this.listeners]) listener(value);
  }

  onChange(listener: (change: DocChange | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ----- layers -----

  private setLayers(layers: readonly Layer[]): void {
    this.#layers = layers;
    if (this.#activeId !== null && !layers.some((layer) => layer.id === this.#activeId)) {
      this.#activeId = layers.length ? layers[layers.length - 1].id : null;
    }
  }

  private replaceLayer(id: number, update: (layer: Layer) => Layer): void {
    this.setLayers(this.#layers.map((layer) => (layer.id === id ? update(layer) : layer)));
  }

  /** Adds the layer (default: above the active layer, or on top) and makes it active. */
  addLayer(input: Layer, index?: number, label: TextKey = 'history.addLayer'): void {
    if (this.layer(input.id)) return;
    const image = this.ownImage(input.image, -1);
    const layer = image === input.image ? input : ({ ...input, image } as Layer);
    const activeIndex = this.#activeId === null ? -1 : this.indexOf(this.#activeId);
    const at = Math.min(this.#layers.length, Math.max(0, index ?? (activeIndex >= 0 ? activeIndex + 1 : this.#layers.length)));
    const previousActive = this.#activeId;
    this.record({
      label,
      bytes: layer.image.data.byteLength,
      redo: () => {
        const next = [...this.#layers];
        next.splice(Math.min(at, next.length), 0, layer);
        this.setLayers(next);
        this.#activeId = layer.id;
        this.touch();
      },
      undo: () => {
        this.setLayers(this.#layers.filter((entry) => entry.id !== layer.id));
        this.#activeId = previousActive !== null && this.layer(previousActive) ? previousActive : this.#activeId;
        this.touch();
      },
    });
  }

  /** Removes the layer; the layer below becomes active (or the new bottom layer). */
  removeLayer(id: number): void {
    const index = this.indexOf(id);
    if (index < 0) return;
    const layer = this.#layers[index];
    const wasActive = this.#activeId;
    this.record({
      label: 'history.removeLayer',
      bytes: 0,
      redo: () => {
        const next = this.#layers.filter((entry) => entry.id !== id);
        this.#layers = next;
        if (this.#activeId === id || (this.#activeId !== null && !next.some((entry) => entry.id === this.#activeId))) {
          this.#activeId = next.length ? next[Math.max(0, Math.min(index - 1, next.length - 1))].id : null;
        }
        if (this.#preview?.layerId === id) this.#preview = null;
        this.touch();
      },
      undo: () => {
        const next = [...this.#layers];
        next.splice(Math.min(index, next.length), 0, layer);
        this.setLayers(next);
        this.#activeId = wasActive;
        this.touch();
      },
    });
  }

  moveLayer(id: number, toIndex: number): void {
    const from = this.indexOf(id);
    if (from < 0) return;
    const to = Math.min(this.#layers.length - 1, Math.max(0, Math.round(toIndex)));
    if (to === from) return;
    const move = (a: number, b: number) => {
      const next = [...this.#layers];
      const [layer] = next.splice(a, 1);
      next.splice(b, 0, layer);
      this.setLayers(next);
      this.touch();
    };
    this.record({ label: 'history.moveLayer', bytes: 0, redo: () => move(from, to), undo: () => move(to, from) });
  }

  setLayerProps(id: number, patch: LayerProps, coalesce?: string): void {
    const layer = this.layer(id);
    if (!layer) return;
    const after = cleanProps(patch);
    const keys = Object.keys(after) as (keyof LayerProps)[];
    const before: LayerProps = {};
    for (const key of keys) (before as Record<string, unknown>)[key] = layer[key];
    if (keys.every((key) => before[key] === after[key])) return;
    const apply = (props: LayerProps) => {
      this.replaceLayer(id, (entry) => ({ ...entry, ...props }) as Layer);
      this.touch();
    };
    this.record({
      label: propsLabel(after),
      bytes: 0,
      coalesce: coalesce === undefined ? undefined : `props:${id}:${coalesce}`,
      redo: () => apply(after),
      undo: () => apply(before),
    });
  }

  /** New text and its render, at `at` (document px, rounded) or at the same position. Undo puts back all three. */
  setTextSpec(id: number, spec: TextSpec, image: RasterImage, coalesce?: string, at?: Point): void {
    const layer = this.layer(id);
    if (!layer || layer.kind !== 'text') return;
    type TextState = { spec: TextSpec; image: RasterImage; x: number; y: number };
    const before: TextState = { spec: layer.spec, image: layer.image, x: layer.x, y: layer.y };
    const after: TextState = { spec: cloneTextSpec(spec), image: this.ownImage(image, id), x: at ? Math.round(at.x) : layer.x, y: at ? Math.round(at.y) : layer.y };
    const apply = (value: TextState) => {
      this.replaceLayer(id, (entry) => (entry.kind === 'text' ? { ...entry, spec: value.spec, image: value.image, x: value.x, y: value.y } : entry));
      this.touch();
    };
    this.record({
      label: 'history.textEdit',
      bytes: image.data.byteLength,
      coalesce: coalesce === undefined ? undefined : `text:${id}:${coalesce}`,
      redo: () => apply(after),
      undo: () => apply(before),
    });
  }

  /** A new shape and its render, at `at` (document px, rounded) or at the same position. Undo puts back all three. */
  setShapeSpec(id: number, spec: ShapeSpec, image: RasterImage, coalesce?: string, at?: Point): void {
    const layer = this.layer(id);
    if (!layer || layer.kind !== 'shape') return;
    type ShapeState = { spec: ShapeSpec; image: RasterImage; x: number; y: number };
    const before: ShapeState = { spec: layer.spec, image: layer.image, x: layer.x, y: layer.y };
    const after: ShapeState = { spec: cloneShapeSpec(spec), image: this.ownImage(image, id), x: at ? Math.round(at.x) : layer.x, y: at ? Math.round(at.y) : layer.y };
    const apply = (value: ShapeState) => {
      this.replaceLayer(id, (entry) => (entry.kind === 'shape' ? { ...entry, spec: value.spec, image: value.image, x: value.x, y: value.y } : entry));
      this.touch();
    };
    this.record({
      label: 'history.shapeEdit',
      bytes: image.data.byteLength,
      coalesce: coalesce === undefined ? undefined : `shape:${id}:${coalesce}`,
      redo: () => apply(after),
      undo: () => apply(before),
    });
  }

  /** A new image for the layer, at `at` (document px) or at the same position. The old image stays by reference for undo. */
  replaceImage(id: number, image: RasterImage, at: Point | null, label: TextKey): void {
    const layer = this.layer(id);
    if (!layer) return;
    const before = { image: layer.image, x: layer.x, y: layer.y };
    const after = { image: this.ownImage(image, id), x: at ? Math.round(at.x) : layer.x, y: at ? Math.round(at.y) : layer.y };
    const apply = (value: { image: RasterImage; x: number; y: number }) => {
      this.replaceLayer(id, (entry) => ({ ...entry, image: value.image, x: value.x, y: value.y }));
      if (this.#preview?.layerId === id) this.#preview = null;
      this.touch({ layerId: id, rect: null });
    };
    this.record({ label, bytes: image.data.byteLength, redo: () => apply(after), undo: () => apply(before) });
  }

  /** The image, or a copy of it when another layer (not `exceptId`) holds it, so that two layers never share pixels. */
  private ownImage(image: RasterImage, exceptId: number): RasterImage {
    return this.#layers.some((entry) => entry.id !== exceptId && entry.image === image) ? cloneRaster(image) : image;
  }

  /** Writes patch.after into the layer image (patch.rect in layer px); undo writes patch.before. */
  commitPatch(id: number, patch: Patch, label: TextKey): void {
    const layer = this.layer(id);
    if (!layer) return;
    const image = layer.image;
    const rect = intersectRect(patch.rect, { x: 0, y: 0, w: image.width, h: image.height });
    if (!rect) return;
    const expected = patch.rect.w * patch.rect.h * 4;
    if (patch.before.length < expected || patch.after.length < expected) throw new RangeError('The patch data is shorter than its rect.');
    const write = (data: Uint8ClampedArray) => {
      writeRect(image, patch.rect, data);
      this.touch({ layerId: id, rect: { ...rect } });
    };
    this.record({
      label,
      bytes: patch.before.byteLength + patch.after.byteLength,
      redo: () => write(patch.after),
      undo: () => write(patch.before),
    });
  }

  // ----- stage -----

  /**
   * The new stage is `rect` of the old stage (crop and canvas size). Each layer and guide moves by -rect.x, -rect.y.
   * With a fill color, the bottom raster layer grows so that the new area of the stage has that color.
   */
  setStage(rect: Rect, fill: Rgba | null, label: TextKey): void {
    const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.max(1, Math.round(rect.w)), h: Math.max(1, Math.round(rect.h)) };
    const oldW = this.#width;
    const oldH = this.#height;
    if (r.x === 0 && r.y === 0 && r.w === oldW && r.h === oldH) return;
    const beforeLayers = this.#layers;
    const beforeGuides = this.#guides;
    const beforeSelection = this.#selection;
    let afterLayers: readonly Layer[] = beforeLayers.map((layer) => ({ ...layer, x: layer.x - r.x, y: layer.y - r.y }) as Layer);
    let bytes = 0;
    if (fill && fill.a > 0) {
      const extended = this.extendBottom(afterLayers, { x: -r.x, y: -r.y, w: oldW, h: oldH }, r.w, r.h, fill);
      afterLayers = extended.layers;
      bytes = extended.bytes;
    }
    const afterGuides = beforeGuides.map((guide) => ({ ...guide, pos: guide.pos - (guide.axis === 'x' ? r.x : r.y) }));
    const afterSelection = beforeSelection ? translateMask(beforeSelection, -r.x, -r.y, r.w, r.h) : null;
    const activeId = this.#activeId;
    const apply = (w: number, h: number, layers: readonly Layer[], guides: readonly Guide[], selection: Mask | null) => {
      this.#width = w;
      this.#height = h;
      this.#layers = layers;
      this.#activeId = activeId !== null && layers.some((layer) => layer.id === activeId) ? activeId : this.#activeId;
      this.#guides = guides;
      this.#selection = selection;
      this.#preview = null;
      this.touch();
    };
    this.record({
      label,
      bytes,
      redo: () => apply(r.w, r.h, afterLayers, afterGuides, afterSelection),
      undo: () => apply(oldW, oldH, beforeLayers, beforeGuides, beforeSelection),
    });
  }

  /**
   * The bottom raster layer, grown to cover the new stage, with `fill` under its pixels in the new area (the stage
   * outside `oldStage`). With no raster layer, a filled layer is added at the bottom.
   */
  private extendBottom(layers: readonly Layer[], oldStage: Rect, w: number, h: number, fill: Rgba): { layers: readonly Layer[]; bytes: number } {
    const stage = { x: 0, y: 0, w, h };
    const index = layers.findIndex((layer) => layer.kind === 'raster' && !layer.generator);
    const inNewArea = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < w && y < h && !(x >= oldStage.x && y >= oldStage.y && x < oldStage.x + oldStage.w && y < oldStage.y + oldStage.h);
    if (index < 0) {
      const image = createRaster(w, h);
      paintArea(image, 0, 0, inNewArea, fill);
      const layer = createRasterLayer(t('doc.backgroundName'), image, 0, 0);
      return { layers: [layer, ...layers], bytes: image.data.byteLength };
    }
    const bottom = layers[index] as RasterLayer;
    const area = unionRect(layerRect(bottom), stage);
    const image = createRaster(area.w, area.h);
    paintArea(image, area.x, area.y, inNewArea, fill);
    blendOnto(image, bottom.image, bottom.x - area.x, bottom.y - area.y);
    const next = [...layers];
    next[index] = { ...bottom, image, x: area.x, y: area.y };
    return { layers: next, bytes: image.data.byteLength };
  }

  // ----- selection, guides, grid, preview -----

  setSelection(mask: Mask | null, label: TextKey = 'history.selection'): void {
    const before = this.#selection;
    const after = mask && mask.bounds ? mask : null;
    if (before === after) return;
    const apply = (value: Mask | null) => {
      this.#selection = value;
      this.touch();
    };
    this.record({ label, bytes: after ? after.data.byteLength : 0, neutral: true, redo: () => apply(after), undo: () => apply(before) });
  }

  setGuides(guides: readonly Guide[], label: TextKey = 'history.guides'): void {
    const before = this.#guides;
    const after = guides.map((guide) => ({ ...guide }));
    for (const guide of after) if (guide.id > this.lastGuideId) this.lastGuideId = guide.id;
    if (before.length === after.length && before.every((guide, i) => guide.id === after[i].id && guide.axis === after[i].axis && guide.pos === after[i].pos)) return;
    const apply = (value: readonly Guide[]) => {
      this.#guides = value;
      this.touch();
    };
    this.record({ label, bytes: 0, neutral: true, redo: () => apply(after), undo: () => apply(before) });
  }

  /** No history. */
  setGrid(grid: GridSpec): void {
    this.#grid = { ...grid };
  }

  /** No history. */
  setPreview(preview: LayerPreview | null): void {
    const old = this.#preview;
    if (old === preview) return;
    this.#preview = preview;
    const target = preview ?? old;
    if (!target) return;
    const sameArea = old && preview && old.layerId === preview.layerId && sameRect(old.rect, preview.rect);
    this.touch({ layerId: target.layerId, rect: sameArea ? { ...preview.rect } : null });
  }

  // ----- paint target, flatten, sample -----

  /** The active raster layer. For a text, shape or generated layer, or no layer, a new raster layer above it (in the history). */
  paintTarget(): RasterLayer {
    const active = this.active;
    if (active && active.kind === 'raster' && !isRenderedLayer(active)) return active;
    const layer = createRasterLayer(this.nextLayerName(), createRaster(this.#width, this.#height), 0, 0);
    this.addLayer(layer, undefined, 'history.addLayer');
    return (this.layer(layer.id) as RasterLayer | null) ?? layer;
  }

  private flatLayers(): FlatLayer[] {
    return this.#layers.filter((layer) => layer.visible && layer.opacity > 0).map((layer) => ({ image: layer.image, x: layer.x, y: layer.y, opacity: layer.opacity }));
  }

  /** The visible layers at stage size, over `background` (transparent by default). */
  flatten(background?: Rgba): RasterImage {
    return flattenLayers(this.#width, this.#height, this.flatLayers(), background);
  }

  /** The composite color at a document pixel (transparent outside the stage). */
  sample(x: number, y: number): Rgba {
    if (x < 0 || y < 0 || x >= this.#width || y >= this.#height) return { r: 0, g: 0, b: 0, a: 0 };
    return sampleComposite(this.flatLayers(), x, y);
  }

  /** A copy of the layer pixels inside rect (layer px), for the `before` of a patch. */
  readLayerRect(id: number, rect: Rect): Uint8ClampedArray | null {
    const layer = this.layer(id);
    return layer ? readRect(layer.image, rect) : null;
  }

  /** A full copy of a layer image, for work that changes pixels in place before a replaceImage. */
  copyLayerImage(id: number): RasterImage | null {
    const layer = this.layer(id);
    return layer ? cloneRaster(layer.image) : null;
  }
}

/** Sets `fill` on each pixel of the image (placed at ox, oy in document px) where `inside(x, y)` holds. */
function paintArea(image: RasterImage, ox: number, oy: number, inside: (x: number, y: number) => boolean, fill: Rgba): void {
  const { width, height, data } = image;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside(x + ox, y + oy)) continue;
      const o = (y * width + x) * 4;
      data[o] = fill.r;
      data[o + 1] = fill.g;
      data[o + 2] = fill.b;
      data[o + 3] = fill.a;
    }
  }
}

/** Draws `src` at (dx, dy) over `dst` with a straight-alpha "over"; pixels over transparent stay exact. */
function blendOnto(dst: RasterImage, src: RasterImage, dx: number, dy: number): void {
  const flat = flattenLayers(dst.width, dst.height, [
    { image: dst, x: 0, y: 0, opacity: 1 },
    { image: src, x: dx, y: dy, opacity: 1 },
  ]);
  dst.data.set(flat.data);
}
