/** Game-feel constants of the adjust feature: panel ranges, defaults, preview budgets and the apply sparkle. */
export const ADJUST_TUNING = {
  hueSaturation: {
    hue: { min: -180, max: 180, step: 1 },
    saturation: { min: -100, max: 100, step: 1 },
    lightness: { min: -100, max: 100, step: 1 },
    /** Color stops of the two hue strips. */
    stripStops: 37,
  },
  levels: {
    /** Height of the histogram canvas, in canvas px (its width is 256, one column per level). */
    histogramHeight: 96,
    /** The tallest bin is cut at this multiple of the mean of the non-empty bins, so one spike does not flatten the rest. */
    histogramCap: 4,
    /** One arrow key press on a handle moves this much; Shift moves 10 times more. */
    keyStep: 1,
    gammaKeyStep: 0.05,
  },
  sharpen: {
    radiusStep: 0.1,
    thresholdStep: 1,
    /** Most pixels of the full-resolution preview region: the part of the layer on screen, cut around its center. */
    previewPixels: 4_000_000,
    /** Wait after the last pan or zoom before the region preview follows the view, in ms. */
    viewSettleMs: 140,
  },
  vignette: {
    defaults: { amount: -45, size: 50, roundness: 0, feather: 55 },
  },
  frame: {
    width: { min: 1, max: 200, step: 1, default: 2 },
    defaultColor: { r: 255, g: 0, b: 0, a: 255 },
    /** "Grow the stage" is on when the panel opens for a new frame. */
    growDefault: false,
  },
  /** The sparkle at the stage center on Apply. */
  applyBurst: { count: 26, speed: [140, 340] as const, life: [0.35, 0.7] as const, size: [4, 9] as const, gravity: 260, jitter: 24 },
} as const;
