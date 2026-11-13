/** Game-feel constants of the geometry feature: snap, crop, guides, grid, rulers and the avatar overlay. */
export const GEOMETRY_TUNING = {
  snap: {
    /** A box or a point snaps to a target nearer than this, in screen CSS px. */
    thresholdPx: 8,
    /** The flash of a new snap hit, then the fade of the lines after the drag ends. */
    flashMs: 360,
    fadeMs: 260,
    /** Extra line width at the start of the flash, in CSS px. */
    flashGrowPx: 4,
    /** A layer snap line runs this far past the moved box and the target layer, in CSS px. */
    layerOverhangPx: 6,
  },
  crop: {
    /** Side of one crop handle, in CSS px. */
    handlePx: 10,
    /** A press nearer than this to a handle grabs it, in CSS px. */
    hitPx: 12,
    /** The new stage outline flashes this long after an apply. */
    applyFlashMs: 520,
    /** Height of the size label pill, in CSS px. */
    labelPx: 22,
  },
  guides: {
    /** With the Move tool, a press nearer than this to a guide drags it, in CSS px. */
    hitPx: 5,
  },
  grid: {
    /** Grid lines closer than this on screen are thinned out, so the grid stays readable. */
    minScreenPx: 8,
  },
  /** The values that the grid settings accept: spacing in document px, columns and rows. */
  gridLimits: {
    spacing: { min: 2, max: 4096 },
    cols: { min: 1, max: 64 },
    rows: { min: 1, max: 64 },
  },
  /** The pixel grid shows above this zoom (8 = 800%). */
  pixelGridAbove: 8,
  rulers: {
    /** Labeled ticks are at least this far apart, in CSS px. */
    labelMinPx: 56,
    /** Minor ticks closer than this are not drawn, in CSS px. */
    minorMinPx: 5,
    fontPx: 10,
  },
  avatar: {
    /** Width of the ring on the ellipse, in CSS px. */
    ringPx: 2,
  },
} as const;
