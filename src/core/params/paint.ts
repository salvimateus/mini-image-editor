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
  /** A textured stroke rounds the pressure to this many levels, so one stroke uses a few tips only. */
  pressureLevels: 16,
  /** One paper for the whole canvas: the grain of each preset comes from this seed. */
  grainSeed: 0x5eed,
  /**
   * The dry media of the pencil tool. Pressure p (0..1) gives r = p ** curve. The stamp size is
   * size * (sizeMin + (1 - sizeMin) * r); flow (stamp coverage) and reach (tooth depth) go from [0] to [1] with r.
   * A pixel gets color where its grain height is above 1 - reach * tip coverage, over a ramp of `soft`.
   */
  sketchPresets: {
    '2b': { hardness: 0.55, sizeMin: 0.8, curve: 1.2, flow: [0.3, 0.75], reach: [0.36, 0.72], soft: 0.16, grain: { cell: 1.4, fine: 0.55, blotch: 0, blotchCell: 1, contrast: 1.6 } },
    '6b': { hardness: 0.45, sizeMin: 0.65, curve: 1, flow: [0.35, 0.95], reach: [0.22, 0.88], soft: 0.18, grain: { cell: 2, fine: 0.5, blotch: 0, blotchCell: 1, contrast: 1.7 } },
    charcoal: { hardness: 0.2, sizeMin: 0.55, curve: 0.9, flow: [0.5, 1], reach: [0.28, 0.95], soft: 0.1, grain: { cell: 3.2, fine: 0.35, blotch: 0.25, blotchCell: 13, contrast: 1.9 } },
    colored: { hardness: 0.65, sizeMin: 0.85, curve: 1, flow: [0.2, 0.55], reach: [0.38, 0.8], soft: 0.22, grain: { cell: 1.2, fine: 0.6, blotch: 0, blotchCell: 1, contrast: 1.4 } },
    chalk: { hardness: 0.5, sizeMin: 0.7, curve: 1, flow: [1, 1], reach: [0.3, 0.72], soft: 0.06, grain: { cell: 3.4, fine: 0.18, blotch: 0.1, blotchCell: 9, contrast: 1.8 } },
    crayon: { hardness: 0.35, sizeMin: 0.75, curve: 1, flow: [0.65, 0.95], reach: [0.45, 0.88], soft: 0.09, grain: { cell: 2.4, fine: 0.2, blotch: 0.35, blotchCell: 8, contrast: 1.6 } },
  },
} as const;

export type SketchPresetId = keyof typeof PAINT_PARAMS.sketchPresets;
/** The presets in the order of the options bar. */
export const SKETCH_PRESET_IDS: readonly SketchPresetId[] = ['2b', '6b', 'charcoal', 'colored', 'chalk', 'crayon'];
