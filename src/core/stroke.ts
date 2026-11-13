import { brushTip, TIP_MIN_COVER, tipCoverage, type BrushTip, type TipShape } from './brush-tip.ts';
import { blendOver } from './fill.ts';
import { fillGrain, type GrainSpec } from './grain.ts';
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
  /** The tip shape; round by default. */
  shape?: TipShape;
  /** Document px; null = everything. */
  selection: Mask | null;
  /** Mode 'clone' only. */
  source?: CloneSource | null;
  /** A dry medium on a paper tooth, where the pressure of each point changes the stamps. Null = a plain tip. */
  texture?: StrokeTexture | null;
}

/** A dry medium: see `PARAMS.paint.sketchPresets` for the model. A textured tip is always round. */
export interface StrokeTexture {
  readonly grain: GrainSpec;
  readonly sizeMin: number;
  readonly curve: number;
  readonly flow: readonly [number, number];
  readonly reach: readonly [number, number];
  readonly soft: number;
}

/** A stroke point in document px. Pressure 0..1 changes only a textured stroke; 1 when it is absent. */
export interface StrokePoint extends Point {
  pressure?: number;
}

/** The stamp of one pressure level of a textured stroke. */
interface Level { size: number; flow: number; depth: number; spacing: number; tip: BrushTip | null }

/**
 * The distance from the point (ux, uy) to the path from (0, 0) to (dx, dy), as the tip `shape` measures it: a
 * straight line for a round tip, the largest axis for a square tip.
 */
function pathDistance(ux: number, uy: number, dx: number, dy: number, shape: TipShape): number {
  if (shape === 'round') {
    const t = Math.max(0, Math.min(1, (ux * dx + uy * dy) / (dx * dx + dy * dy)));
    return Math.hypot(ux - t * dx, uy - t * dy);
  }
  // max(|ux - t dx|, |uy - t dy|) is convex and piecewise linear in t: its minimum is at an end or at a break.
  let best = Math.min(axisDistance(ux, uy, dx, dy, 0), axisDistance(ux, uy, dx, dy, 1));
  if (dx !== 0) best = Math.min(best, axisDistance(ux, uy, dx, dy, ux / dx));
  if (dy !== 0) best = Math.min(best, axisDistance(ux, uy, dx, dy, uy / dy));
  if (dx !== dy) best = Math.min(best, axisDistance(ux, uy, dx, dy, (ux - uy) / (dx - dy)));
  if (dx !== -dy) best = Math.min(best, axisDistance(ux, uy, dx, dy, (ux + uy) / (dx + dy)));
  return best;
}

/** The largest-axis distance from (ux, uy) to the path point at t, with t held in 0..1. */
function axisDistance(ux: number, uy: number, dx: number, dy: number, t: number): number {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return Math.max(Math.abs(ux - k * dx), Math.abs(uy - k * dy));
}

/** The old pixels and the stroke coverage of one tile, kept from the first stamp that touches it. */
interface Tile { x: number; y: number; w: number; h: number; before: Uint8ClampedArray; cover: Float32Array; grain: Float32Array | null }

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
  private readonly hardness: number;
  private readonly texture: StrokeTexture | null;
  /** The stamps of the pressure levels of a textured stroke; the stroke keeps its tips, so the tip cache does not thrash. */
  private readonly levels: Level[] = [];
  private readonly tilePx = PAINT_PARAMS.strokeTilePx;
  private readonly tilesX: number;
  private readonly tiles = new Map<number, Tile>();
  private last: Point | null = null;
  private lastPressure = 1;
  /** The center of the last stamp (document px); a square tip sweeps from it to the next one. */
  private lastStamp: Point | null = null;
  /** The distance from the last stamp to the next one. */
  private step = 0;
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
    this.texture = options.texture ?? null;
    this.hardness = options.hardness;
    this.tip = brushTip(options.size, options.hardness, aliased, this.texture ? 'round' : (options.shape ?? 'round'));
    const ratio = aliased ? PAINT_PARAMS.aliasedSpacing : PAINT_PARAMS.spacing;
    this.spacing = Math.max(PAINT_PARAMS.minSpacing, this.tip.size * ratio);
    this.step = this.spacing;
    const texture = this.texture;
    if (texture) {
      const count = PAINT_PARAMS.pressureLevels;
      for (let i = 0; i < count; i++) {
        const r = (i / (count - 1)) ** texture.curve;
        const size = Math.max(1, Math.round(options.size * (texture.sizeMin + (1 - texture.sizeMin) * r)));
        this.levels.push({
          size,
          flow: texture.flow[0] + (texture.flow[1] - texture.flow[0]) * r,
          depth: texture.reach[0] + (texture.reach[1] - texture.reach[0]) * r,
          spacing: Math.max(PAINT_PARAMS.minSpacing, size * ratio),
          tip: null,
        });
      }
    }
    this.tilesX = Math.ceil(this.image.width / this.tilePx);
  }

  private level(pressure: number): Level {
    const count = this.levels.length;
    const p = pressure <= 0 ? 0 : pressure >= 1 ? 1 : pressure;
    const level = this.levels[Math.round(p * (count - 1))];
    level.tip ??= brushTip(level.size, this.hardness, false);
    return level;
  }

  /** The last point of the stroke in document px, for a straight line from it. */
  get lastPoint(): Point | null {
    return this.last ? { ...this.last } : null;
  }

  /** Stamps along the path through the points (document px). Returns the dirty rect in layer px, or null. */
  addPoints(points: readonly StrokePoint[]): Rect | null {
    if (this.done) return null;
    let dirty: Rect | null = null;
    const add = (rect: Rect | null) => {
      if (rect) dirty = unionRect(dirty, rect);
    };
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      const pressure = typeof point.pressure === 'number' && Number.isFinite(point.pressure) ? point.pressure : 1;
      const last = this.last;
      if (!last) {
        add(this.stamp(point.x, point.y, pressure));
        this.last = { x: point.x, y: point.y };
        this.lastPressure = pressure;
        this.lastStamp = { x: point.x, y: point.y };
        this.carry = 0;
        continue;
      }
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      const distance = Math.hypot(dx, dy);
      if (distance === 0) continue;
      const from = this.lastPressure;
      let at = this.step - this.carry;
      while (at <= distance) {
        const k = at / distance;
        const cx = last.x + dx * k;
        const cy = last.y + dy * k;
        const p = from + (pressure - from) * k;
        // Separate square stamps leave a notch at each corner on a diagonal; a sweep fills it.
        if (this.tip.shape === 'square' && this.lastStamp) add(this.sweep(this.lastStamp, cx, cy));
        else add(this.stamp(cx, cy, p));
        this.lastStamp = { x: cx, y: cy };
        this.step = this.texture ? this.level(p).spacing : this.spacing;
        at += this.step;
      }
      this.carry = distance - (at - this.step);
      this.last = { x: point.x, y: point.y };
      this.lastPressure = pressure;
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
  private stamp(cx: number, cy: number, pressure: number): Rect | null {
    if (this.texture) return this.stampTexture(cx, cy, this.level(pressure));
    const tip = this.tip;
    const px = Math.round(cx - this.ox - tip.side / 2);
    const py = Math.round(cy - this.oy - tip.side / 2);
    const rect = this.clip(px + tip.bounds.x, py + tip.bounds.y, px + tip.bounds.x + tip.bounds.w, py + tip.bounds.y + tip.bounds.h);
    if (!rect) return null;
    const x1 = rect.x + rect.w;
    const y1 = rect.y + rect.h;
    const size = this.tilePx;
    let touched = false;
    for (let ty = Math.floor(rect.y / size); ty <= Math.floor((y1 - 1) / size); ty++) {
      for (let tx = Math.floor(rect.x / size); tx <= Math.floor((x1 - 1) / size); tx++) {
        const tile = this.tileAt(tx, ty);
        const ax = Math.max(rect.x, tile.x);
        const ay = Math.max(rect.y, tile.y);
        const bx = Math.min(x1, tile.x + tile.w);
        const by = Math.min(y1, tile.y + tile.h);
        for (let y = ay; y < by; y++) {
          for (let x = ax; x < bx; x++) {
            const value = tip.data[(y - py) * tip.side + (x - px)];
            if (value > 0 && this.put(tile, x, y, value)) touched = true;
          }
        }
      }
    }
    if (!touched) return null;
    this.changed = unionRect(this.changed, rect);
    return rect;
  }

  /**
   * One textured tip: a pixel gets color where the paper is higher than 1 - depth * tip coverage, so a light touch
   * colors the peaks only and a hard press fills the valleys too.
   */
  private stampTexture(cx: number, cy: number, level: Level): Rect | null {
    const tip = level.tip as BrushTip;
    const texture = this.texture as StrokeTexture;
    const px = Math.round(cx - this.ox - tip.side / 2);
    const py = Math.round(cy - this.oy - tip.side / 2);
    const rect = this.clip(px + tip.bounds.x, py + tip.bounds.y, px + tip.bounds.x + tip.bounds.w, py + tip.bounds.y + tip.bounds.h);
    if (!rect) return null;
    const x1 = rect.x + rect.w;
    const y1 = rect.y + rect.h;
    const size = this.tilePx;
    const { flow, depth } = level;
    const soft = 1 / Math.max(0.001, texture.soft);
    let touched = false;
    for (let ty = Math.floor(rect.y / size); ty <= Math.floor((y1 - 1) / size); ty++) {
      for (let tx = Math.floor(rect.x / size); tx <= Math.floor((x1 - 1) / size); tx++) {
        const tile = this.tileAt(tx, ty);
        const grain = tile.grain as Float32Array;
        const ax = Math.max(rect.x, tile.x);
        const ay = Math.max(rect.y, tile.y);
        const bx = Math.min(x1, tile.x + tile.w);
        const by = Math.min(y1, tile.y + tile.h);
        for (let y = ay; y < by; y++) {
          const row = (y - py) * tip.side - px;
          const grainRow = (y - tile.y) * tile.w - tile.x;
          for (let x = ax; x < bx; x++) {
            const value = tip.data[row + x];
            if (value <= 0) continue;
            const tooth = (grain[grainRow + x] - 1 + value * depth) * soft;
            if (tooth <= 0) continue;
            if (this.put(tile, x, y, (tooth >= 1 ? 1 : tooth) * flow)) touched = true;
          }
        }
      }
    }
    if (!touched) return null;
    this.changed = unionRect(this.changed, rect);
    return rect;
  }

  /**
   * The tip swept from the stamp at `from` to the stamp at (cx, cy), document px. Each pixel takes the coverage of
   * the nearest tip position on the path, so the result is the same as a stamp at every point of it.
   */
  private sweep(from: Point, cx: number, cy: number): Rect | null {
    const tip = this.tip;
    const half = tip.side / 2;
    // Tip centers in layer px, snapped as `stamp` snaps them.
    const ax = Math.round(from.x - this.ox - half) + half;
    const ay = Math.round(from.y - this.oy - half) + half;
    const dx = Math.round(cx - this.ox - half) + half - ax;
    const dy = Math.round(cy - this.oy - half) + half - ay;
    if (dx === 0 && dy === 0) return this.stamp(cx, cy, 1);
    const reach = tip.size / 2 + 0.5;
    const rect = this.clip(
      Math.floor(Math.min(ax, ax + dx) - reach),
      Math.floor(Math.min(ay, ay + dy) - reach),
      Math.ceil(Math.max(ax, ax + dx) + reach),
      Math.ceil(Math.max(ay, ay + dy) + reach),
    );
    if (!rect) return null;
    const x1 = rect.x + rect.w;
    const y1 = rect.y + rect.h;
    const size = this.tilePx;
    let touched = false;
    for (let ty = Math.floor(rect.y / size); ty <= Math.floor((y1 - 1) / size); ty++) {
      for (let tx = Math.floor(rect.x / size); tx <= Math.floor((x1 - 1) / size); tx++) {
        const tile = this.tileAt(tx, ty);
        const left = Math.max(rect.x, tile.x);
        const right = Math.min(x1, tile.x + tile.w);
        const by = Math.min(y1, tile.y + tile.h);
        for (let y = Math.max(rect.y, tile.y); y < by; y++) {
          const uy = y + 0.5 - ay;
          // The part of the path where the tip reaches this row gives the row span.
          let lo = 0;
          let hi = 1;
          if (dy !== 0) {
            const t1 = (uy - reach) / dy;
            const t2 = (uy + reach) / dy;
            lo = Math.max(0, Math.min(t1, t2));
            hi = Math.min(1, Math.max(t1, t2));
            if (lo > hi) continue;
          } else if (Math.abs(uy) >= reach) continue;
          const xa = ax + lo * dx;
          const xb = ax + hi * dx;
          const start = Math.max(left, Math.ceil(Math.min(xa, xb) - reach - 0.5));
          const end = Math.min(right, Math.floor(Math.max(xa, xb) + reach - 0.5) + 1);
          for (let x = start; x < end; x++) {
            const d = pathDistance(x + 0.5 - ax, uy, dx, dy, tip.shape);
            const value = tipCoverage(d, tip.size, tip.hardness, tip.aliased);
            if (value > TIP_MIN_COVER && this.put(tile, x, y, value)) touched = true;
          }
        }
      }
    }
    if (!touched) return null;
    this.changed = unionRect(this.changed, rect);
    return rect;
  }

  /** The rect x0..x1, y0..y1 (layer px) inside the image and the selection bounds, or null when empty. */
  private clip(x0: number, y0: number, x1: number, y1: number): Rect | null {
    const { width, height } = this.image;
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(width, x1);
    y1 = Math.min(height, y1);
    const sel = this.selection;
    if (sel) {
      const b = sel.bounds;
      if (!b) return null;
      x0 = Math.max(x0, b.x - this.ox);
      y0 = Math.max(y0, b.y - this.oy);
      x1 = Math.min(x1, b.x + b.w - this.ox);
      y1 = Math.min(y1, b.y + b.h - this.oy);
    }
    return x1 <= x0 || y1 <= y0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** Gives the pixel (x, y) of the tile the coverage `value`, when it is larger than its current one. */
  private put(tile: Tile, x: number, y: number, value: number): boolean {
    const sel = this.selection;
    if (sel) {
      const dx = x + this.ox;
      const dy = y + this.oy;
      if (dx < 0 || dy < 0 || dx >= sel.width || dy >= sel.height) return false;
      value *= sel.data[dy * sel.width + dx] / 255;
      if (value <= 0) return false;
    }
    const i = (y - tile.y) * tile.w + (x - tile.x);
    if (value <= tile.cover[i]) return false;
    tile.cover[i] = value;
    this.shade(tile, i, x, y, value);
    return true;
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
    let grain: Float32Array | null = null;
    if (this.texture) {
      // The paper is fixed to the canvas, so its heights come from document px.
      grain = new Float32Array(w * h);
      fillGrain(grain, x + this.ox, y + this.oy, w, h, this.texture.grain, PAINT_PARAMS.grainSeed);
    }
    const tile: Tile = { x, y, w, h, before: readRect(this.image, { x, y, w, h }), cover: new Float32Array(w * h), grain };
    this.tiles.set(key, tile);
    return tile;
  }
}
