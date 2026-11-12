/** Algorithm constants of the paint feature: brush tips, strokes and the flood fill. */
export const PAINT_PARAMS = {
  /** Largest brush diameter, in document px. */
  maxSize: 500,
  /** Stamp spacing as a fraction of the brush diameter; small enough that a soft edge shows no beads. */
  spacing: 0.12,
  /** The aliased pencil stamps more often, so a one-pixel line has no gaps on a diagonal. */
  aliasedSpacing: 0.25,
  /** Smallest stamp spacing, in document px. */
  minSpacing: 0.5,
  /** Side of one tile of the stroke backup, in px. A stroke keeps the old pixels only for the tiles it touches. */
  strokeTilePx: 64,
  /** Brush tips that stay cached; each change of size or hardness makes one. */
  tipCacheSize: 12,
  /** Hardness is rounded to this step for the tip cache. */
  hardnessStep: 0.01,
  /** Anti-aliased flood fill: the coverage of an edge pixel falls to 0 over this RGBA distance above the tolerance. */
  fillEdgeRamp: 48,
} as const;
