import { PAINT_PARAMS } from './params/paint.ts';

/** A round tip measures the distance to its center in a straight line; a square tip, on the largest axis. */
export type TipShape = 'round' | 'square';
export const TIP_SHAPES: readonly TipShape[] = ['round', 'square'];

/** The coverage map of a tip: `side` x `side` values 0..1, with the tip center at (side / 2, side / 2). */
export interface BrushTip {
  readonly size: number;
  readonly hardness: number;
  readonly aliased: boolean;
  readonly shape: TipShape;
  readonly side: number;
  readonly data: Float32Array;
  /** The rect of the cells with coverage > 0, in tip px. */
  readonly bounds: { x: number; y: number; w: number; h: number };
}

const cache = new Map<string, BrushTip>();

function smoothFall(t: number): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return 1 - c * c * (3 - 2 * c);
}

/** Coverage below this counts as none. */
export const TIP_MIN_COVER = 1 / 512;

/**
 * The coverage 0..1 of a tip of `size` px at distance `d` from its center (a straight line for a round tip, the
 * largest axis for a square tip). The coverage is 0 from `size / 2 + 0.5`.
 */
export function tipCoverage(d: number, size: number, hardness: number, aliased: boolean): number {
  const radius = size / 2;
  if (aliased) return d <= Math.max(0.5, radius) ? 1 : 0;
  const inner = radius * hardness;
  const edge = Math.min(1, Math.max(0, radius - d + 0.5));
  const fall = radius > inner && d > inner ? smoothFall((d - inner) / (radius - inner)) : 1;
  return edge * fall;
}

function buildTip(size: number, hardness: number, aliased: boolean, shape: TipShape): BrushTip {
  // One extra pixel on each side keeps the anti-aliased edge inside the map.
  const side = aliased ? Math.max(1, Math.ceil(size)) : Math.ceil(size) + 2;
  const center = side / 2;
  const data = new Float32Array(side * side);
  let x0 = side;
  let y0 = side;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const ux = x + 0.5 - center;
      const uy = y + 0.5 - center;
      const d = shape === 'square' ? Math.max(Math.abs(ux), Math.abs(uy)) : Math.hypot(ux, uy);
      const value = tipCoverage(d, size, hardness, aliased);
      if (value <= TIP_MIN_COVER) continue;
      data[y * side + x] = value;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  const bounds = x1 < 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  return { size, hardness, aliased, shape, side, data, bounds };
}

/**
 * The cached coverage map of a tip of `size` px. Hardness 1 is a hard edge with anti-alias; hardness 0 fades
 * from the center. `aliased` gives a binary tip (the pencil), where hardness does not apply. A square tip is
 * parallel to the axes, and its side is `size`.
 */
export function brushTip(size: number, hardness: number, aliased: boolean, shape: TipShape = 'round'): BrushTip {
  const s = Math.max(1, Math.min(PAINT_PARAMS.maxSize, Math.round(size)));
  const step = PAINT_PARAMS.hardnessStep;
  const h = aliased ? 1 : Math.round(Math.max(0, Math.min(1, hardness)) / step) * step;
  const key = `${s}|${h.toFixed(2)}|${aliased ? 1 : 0}|${shape}`;
  const known = cache.get(key);
  if (known) {
    cache.delete(key);
    cache.set(key, known);
    return known;
  }
  const tip = buildTip(s, h, aliased, shape);
  cache.set(key, tip);
  while (cache.size > PAINT_PARAMS.tipCacheSize) cache.delete(cache.keys().next().value as string);
  return tip;
}
