import { brushTip, type BrushTip } from './brush-tip.ts';
import { blendOver } from './fill.ts';
import type { Mask } from './mask.ts';
import { PAINT_PARAMS } from './params/paint.ts';
import { readRect, unionRect } from './raster.ts';
import type { Patch, Point, RasterImage, Rect, Rgba } from './types.ts';

export type StrokeMode = 'paint' | 'erase' | 'clone';

/** The pixels that a clone stroke copies: `image` in document px; the pixel at p copies the source pixel at p + (dx, dy). */
export interface CloneSource { image: RasterImage; dx: number; dy: number }

export interface StrokeOptions {
  /** The layer image; the stroke writes into it in place. */
  image: RasterImage;
  /** The layer position in document px. */
  offset: Point;
  mode: StrokeMode;
  /** The paint color (mode 'paint'). */
  color: Rgba;
  /** Diameter in px; hardness and opacity 0..1. */
  size: number;
  hardness: number;
  opacity: number;
  /** A binary tip with no anti-alias (the pencil). */
  aliased?: boolean;
  /** Document px; null = everything. */
  selection: Mask | null;
  /** Mode 'clone' only. */
  source?: CloneSource | null;
}

/** The old pixels and the stroke coverage of one tile, kept from the first stamp that touches it. */
interface Tile { x: number; y: number; w: number; h: number; before: Uint8ClampedArray; cover: Float32Array }

/**
 * One drag of a paint tool on one layer image. Each pixel gets the largest coverage of the stamps that touch it, so
 * the opacity does not build up inside one stroke. The pixels before the stroke are kept only for the touched tiles.
 */
export class Stroke {
  private readonly image: RasterImage;
  private readonly ox: number;
  private readonly oy: number;
  private readonly mode: StrokeMode;
  private readonly color: Rgba;
  private readonly opacity: number;
  private readonly selection: Mask | null;
  private readonly source: CloneSource | null;
  private readonly tip: BrushTip;
  private readonly spacing: number;
  private readonly tilePx = PAINT_PARAMS.strokeTilePx;
  private readonly tilesX: number;
  private readonly tiles = new Map<number, Tile>();
  private last: Point | null = null;
  private carry = 0;
  private changed: Rect | null = null;
  private done = false;

  constructor(options: StrokeOptions) {
    this.image = options.image;
    this.ox = Math.round(options.offset.x);
    this.oy = Math.round(options.offset.y);
    this.mode = options.mode;
    this.color = { ...options.color };
    this.opacity = Math.max(0, Math.min(1, options.opacity));
    this.selection = options.selection;
    const source = options.mode === 'clone' ? options.source : null;
    this.source = source ? { image: source.image, dx: Math.round(source.dx), dy: Math.round(source.dy) } : null;
    const aliased = options.aliased ?? false;
    this.tip = brushTip(options.size, options.hardness, aliased);
    const ratio = aliased ? PAINT_PARAMS.aliasedSpacing : PAINT_PARAMS.spacing;
    this.spacing = Math.max(PAINT_PARAMS.minSpacing, this.tip.size * ratio);
    this.tilesX = Math.ceil(this.image.width / this.tilePx);
  }

  /** The last point of the stroke in document px, for a straight line from it. */
  get lastPoint(): Point | null {
    return this.last ? { ...this.last } : null;
  }

  /** Stamps along the path through the points (document px). Returns the dirty rect in layer px, or null. */
  addPoints(points: readonly Point[]): Rect | null {
    if (this.done) return null;
    let dirty: Rect | null = null;
    const add = (rect: Rect | null) => {
      if (rect) dirty = unionRect(dirty, rect);
    };
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const last = this.last;
      if (!last) {
        add(this.stamp(point.x, point.y));
        this.last = { x: point.x, y: point.y };
        this.carry = 0;
        continue;
      }
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      const distance = Math.hypot(dx, dy);
      if (distance === 0) continue;
      let at = this.spacing - this.carry;
      while (at <= distance) {
        const k = at / distance;
        add(this.stamp(last.x + dx * k, last.y + dy * k));
        at += this.spacing;
      }
      this.carry = distance - (at - this.spacing);
      this.last = { x: point.x, y: point.y };
    }
    return dirty;
  }

  /** Ends the stroke. The patch (layer px) holds the pixels before and after; null when no pixel changed. */
  end(): Patch | null {
    if (this.done) return null;
    this.done = true;
    const rect = this.changed;
    if (!rect) return null;
    const after = readRect(this.image, rect);
    const before = after.slice();
    for (const tile of this.tiles.values()) {
      const x0 = Math.max(rect.x, tile.x);
      const y0 = Math.max(rect.y, tile.y);
      const x1 = Math.min(rect.x + rect.w, tile.x + tile.w);
      const y1 = Math.min(rect.y + rect.h, tile.y + tile.h);
      if (x1 <= x0 || y1 <= y0) continue;
      const rowBytes = (x1 - x0) * 4;
      for (let y = y0; y < y1; y++) {
        const s = ((y - tile.y) * tile.w + (x0 - tile.x)) * 4;
        before.set(tile.before.subarray(s, s + rowBytes), ((y - rect.y) * rect.w + (x0 - rect.x)) * 4);
      }
    }
    this.tiles.clear();
    for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) return { rect, before, after };
    return null;
  }

  /** Puts the old pixels back. Returns the rect that changed back (layer px), or null. */
  cancel(): Rect | null {
    if (this.done) return null;
    this.done = true;
    const { width, data } = this.image;
    for (const tile of this.tiles.values()) {
      const rowBytes = tile.w * 4;
      for (let y = 0; y < tile.h; y++) {
        data.set(tile.before.subarray(y * rowBytes, (y + 1) * rowBytes), ((tile.y + y) * width + tile.x) * 4);
      }
    }
    this.tiles.clear();
    return this.changed;
  }

  /** One tip at (cx, cy) in document px. Returns the rect it covers in layer px, or null. */
  private stamp(cx: number, cy: number): Rect | null {
    const tip = this.tip;
    const { width, height } = this.image;
    const px = Math.round(cx - this.ox - tip.side / 2);
    const py = Math.round(cy - this.oy - tip.side / 2);
    let x0 = Math.max(0, px + tip.bounds.x);
    let y0 = Math.max(0, py + tip.bounds.y);
    let x1 = Math.min(width, px + tip.bounds.x + tip.bounds.w);
    let y1 = Math.min(height, py + tip.bounds.y + tip.bounds.h);
    const sel = this.selection;
    if (sel) {
      const b = sel.bounds;
      if (!b) return null;
      x0 = Math.max(x0, b.x - this.ox);
      y0 = Math.max(y0, b.y - this.oy);
      x1 = Math.min(x1, b.x + b.w - this.ox);
      y1 = Math.min(y1, b.y + b.h - this.oy);
    }
    if (x1 <= x0 || y1 <= y0) return null;
    const size = this.tilePx;
    let touched = false;
    for (let ty = Math.floor(y0 / size); ty <= Math.floor((y1 - 1) / size); ty++) {
      for (let tx = Math.floor(x0 / size); tx <= Math.floor((x1 - 1) / size); tx++) {
        const tile = this.tileAt(tx, ty);
        const ax = Math.max(x0, tile.x);
        const ay = Math.max(y0, tile.y);
        const bx = Math.min(x1, tile.x + tile.w);
        const by = Math.min(y1, tile.y + tile.h);
        for (let y = ay; y < by; y++) {
          for (let x = ax; x < bx; x++) {
            let value = tip.data[(y - py) * tip.side + (x - px)];
            if (value <= 0) continue;
            if (sel) {
              const dx = x + this.ox;
              const dy = y + this.oy;
              if (dx < 0 || dy < 0 || dx >= sel.width || dy >= sel.height) continue;
              value *= sel.data[dy * sel.width + dx] / 255;
              if (value <= 0) continue;
            }
            const i = (y - tile.y) * tile.w + (x - tile.x);
            if (value <= tile.cover[i]) continue;
            tile.cover[i] = value;
            this.shade(tile, i, x, y, value);
            touched = true;
          }
        }
      }
    }
    if (!touched) return null;
    const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    this.changed = unionRect(this.changed, rect);
    return rect;
  }

  /** The pixel (x, y) of the image = its old value with the stroke at `cover` (0..1). */
  private shade(tile: Tile, i: number, x: number, y: number, cover: number): void {
    const data = this.image.data;
    const d = (y * this.image.width + x) * 4;
    const b = i * 4;
    const before = tile.before;
    data[d] = before[b];
    data[d + 1] = before[b + 1];
    data[d + 2] = before[b + 2];
    data[d + 3] = before[b + 3];
    const alpha = cover * this.opacity;
    if (this.mode === 'erase') {
      data[d + 3] = before[b + 3] * (1 - alpha);
      return;
    }
    if (this.mode === 'paint') {
      blendOver(data, d, this.color, (alpha * this.color.a) / 255);
      return;
    }
    const source = this.source;
    if (!source) return;
    const sx = x + this.ox + source.dx;
    const sy = y + this.oy + source.dy;
    const img = source.image;
    if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) return;
    const s = (sy * img.width + sx) * 4;
    const sa = img.data[s + 3];
    if (sa === 0) return;
    blendOver(data, d, { r: img.data[s], g: img.data[s + 1], b: img.data[s + 2], a: sa }, (alpha * sa) / 255);
  }

  private tileAt(tx: number, ty: number): Tile {
    const key = ty * this.tilesX + tx;
    const known = this.tiles.get(key);
    if (known) return known;
    const size = this.tilePx;
    const x = tx * size;
    const y = ty * size;
    const w = Math.min(size, this.image.width - x);
    const h = Math.min(size, this.image.height - y);
    const tile: Tile = { x, y, w, h, before: readRect(this.image, { x, y, w, h }), cover: new Float32Array(w * h) };
    this.tiles.set(key, tile);
    return tile;
  }
}
