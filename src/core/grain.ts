/** The look of one paper tooth. Each value is in document px or in grain height (0..1). */
export interface GrainSpec {
  /** Lattice step of the main bumps, in px. */
  readonly cell: number;
  /** 0..1: the part of the height that is per-pixel noise (a fine tooth) instead of smooth bumps. */
  readonly fine: number;
  /** 0..1: the part of the height that comes from large, slow blotches. */
  readonly blotch: number;
  /** Lattice step of the blotches, in px. */
  readonly blotchCell: number;
  /** Spread of the heights around 0.5: above 1 gives more pure peaks and valleys. */
  readonly contrast: number;
}

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  let tx = fx - ix;
  let ty = fy - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** The height 0..1 of the paper at the document pixel (x, y): 1 is a peak, 0 a valley. The same pixel always gives the same height. */
export function grainHeight(x: number, y: number, spec: GrainSpec, seed: number): number {
  const coarse = valueNoise(x, y, spec.cell, seed) * 0.65 + valueNoise(x, y, spec.cell * 0.45, seed + 1) * 0.35;
  let g = coarse + (hash(x, y, seed + 2) - coarse) * spec.fine;
  if (spec.blotch > 0) g += (valueNoise(x, y, spec.blotchCell, seed + 3) - g) * spec.blotch;
  g = 0.5 + (g - 0.5) * spec.contrast;
  return g < 0 ? 0 : g > 1 ? 1 : g;
}

/** Writes the heights of the rect x0, y0, w, h (document px) into `out`, row after row. */
export function fillGrain(out: Float32Array, x0: number, y0: number, w: number, h: number, spec: GrainSpec, seed: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = grainHeight(x0 + x, y0 + y, spec, seed);
  }
}
