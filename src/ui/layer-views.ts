import { untrack } from 'svelte';
import type { DocChange, EditorDoc } from '../app/doc.svelte.ts';
import type { Layer } from '../app/layers.ts';
import { TUNING } from '../app/tuning/index.ts';
import { intersectRect, readRect } from '../core/raster.ts';
import type { RasterImage, Rect } from '../core/types.ts';

/** One display canvas of a part of an image; x, y, w, h in image px. */
export interface ViewTile {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly canvas: HTMLCanvasElement;
}

/** The display surface of one RasterImage. Never read pixels back from it: a canvas stores premultiplied alpha. */
export interface ImageView {
  readonly image: RasterImage;
  readonly tiles: readonly ViewTile[];
}

interface HistoryMark {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  bytes: number;
}

/**
 * Display canvases of the layer images of one document, kept by RasterImage. A view is built on first use, updated
 * by dirty rect from doc.onChange, and released when no layer and no preview uses its image any more.
 */
export class LayerViews {
  private readonly doc: EditorDoc;
  private views = new WeakMap<RasterImage, ImageView>();
  private readonly live = new Set<ImageView>();
  /** Images written in place at least once (commitPatch): an undo or a redo can change their pixels again. */
  private readonly patched = new WeakSet<RasterImage>();
  private mark: HistoryMark | null = null;
  private markPending = false;
  private stop: (() => void) | null = null;

  constructor(doc: EditorDoc) {
    this.doc = doc;
  }

  /** Follows the document changes; `onchange` runs after each update of the views. Returns the stop function. */
  connect(onchange: () => void): () => void {
    this.stop?.();
    this.mark = this.readMark();
    // A change can come from inside an effect: the reads of the views must not become its dependencies.
    const off = this.doc.onChange((change) => {
      untrack(() => this.apply(change));
      onchange();
    });
    this.stop = () => {
      off();
      this.stop = null;
    };
    return this.stop;
  }

  /** The view of the layer image, built now when it does not exist. */
  viewOf(layer: Layer): ImageView {
    return this.viewOfImage(layer.image);
  }

  /** The view of any document image (a layer image or a preview image). */
  viewOfImage(image: RasterImage): ImageView {
    const known = this.views.get(image);
    if (known) return known;
    const view: ImageView = { image, tiles: buildTiles(image) };
    this.views.set(image, view);
    this.live.add(view);
    return view;
  }

  /** Copies the pixels of `rect` (layer px) of the layer image to its view. Without a view, nothing happens. */
  syncRect(layer: Layer, rect: Rect): void {
    this.patched.add(layer.image);
    const view = this.views.get(layer.image);
    if (view) uploadRect(view, rect);
  }

  /** Frees every display canvas. */
  dispose(): void {
    this.stop?.();
    for (const view of this.live) releaseView(view);
    this.live.clear();
    this.views = new WeakMap();
  }

  private apply(change: DocChange | null): void {
    if (change) {
      this.scheduleMark();
      const layer = this.doc.layer(change.layerId);
      const previewOnly = this.isPreviewOnly(change);
      if (layer && change.rect && !previewOnly) this.syncRect(layer, change.rect);
      // A new preview image replaces the old one, whose view is no longer used.
      if (!change.rect || previewOnly) this.prune();
      return;
    }
    // A null change is a structure change, an undo or a redo. Only an undo or a redo can write pixels in place.
    if (this.historyMoved()) {
      for (const layer of this.doc.layers) {
        const view = this.views.get(layer.image);
        if (view && this.patched.has(layer.image)) uploadRect(view, { x: 0, y: 0, w: layer.image.width, h: layer.image.height });
      }
    }
    this.prune();
  }

  /** setPreview tells the layer of the preview, but the layer pixels did not change. */
  private isPreviewOnly(change: DocChange): boolean {
    const preview = this.doc.preview;
    return !!preview && preview.layerId === change.layerId && !!change.rect && sameRect(preview.rect, change.rect);
  }

  /** Releases each view whose image no layer and no preview uses. */
  private prune(): void {
    const used = new Set<RasterImage>();
    for (const layer of this.doc.layers) used.add(layer.image);
    const preview = this.doc.preview;
    if (preview) used.add(preview.image);
    for (const view of this.live) {
      if (used.has(view.image)) continue;
      releaseView(view);
      this.live.delete(view);
      this.views.delete(view.image);
    }
  }

  /**
   * True when the history stack moved since the last settled change. The history of a normal edit is pushed after
   * its change event, so the mark is read again only after the event settles.
   */
  private historyMoved(): boolean {
    const now = this.readMark();
    const moved = !this.mark || !sameMark(now, this.mark);
    this.mark = now;
    this.scheduleMark();
    return moved;
  }

  private scheduleMark(): void {
    if (this.markPending) return;
    this.markPending = true;
    queueMicrotask(() => {
      this.markPending = false;
      this.mark = this.readMark();
    });
  }

  private readMark(): HistoryMark {
    const history = this.doc.history;
    return { canUndo: history.canUndo, canRedo: history.canRedo, undoLabel: history.undoLabel, redoLabel: history.redoLabel, bytes: history.bytes };
  }
}

function sameMark(a: HistoryMark, b: HistoryMark): boolean {
  return a.canUndo === b.canUndo && a.canRedo === b.canRedo && a.undoLabel === b.undoLabel && a.redoLabel === b.redoLabel && a.bytes === b.bytes;
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function buildTiles(image: RasterImage): ViewTile[] {
  const tiles: ViewTile[] = [];
  const max = TUNING.stage.maxTilePx;
  for (let y = 0; y < image.height; y += max) {
    for (let x = 0; x < image.width; x += max) {
      const w = Math.min(max, image.width - x);
      const h = Math.min(max, image.height - y);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      tiles.push({ x, y, w, h, canvas });
    }
  }
  uploadRect({ image, tiles }, { x: 0, y: 0, w: image.width, h: image.height });
  return tiles;
}

/** putImageData of the image pixels inside `rect` into each tile that it crosses. */
function uploadRect(view: ImageView, rect: Rect): void {
  for (const tile of view.tiles) {
    const part = intersectRect(rect, tile);
    if (!part) continue;
    const ctx = tile.canvas.getContext('2d');
    if (!ctx) continue;
    const pixels = readRect(view.image, part) as Uint8ClampedArray<ArrayBuffer>;
    ctx.putImageData(new ImageData(pixels, part.w, part.h), part.x - tile.x, part.y - tile.y);
  }
}

/** A zero-size canvas gives its memory back at once, without a wait for the garbage collector. */
function releaseView(view: ImageView): void {
  for (const tile of view.tiles) {
    tile.canvas.width = 0;
    tile.canvas.height = 0;
  }
}
