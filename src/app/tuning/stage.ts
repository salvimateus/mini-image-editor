/** Game-feel constants of the stage: camera, zoom, pan, frame and canvas budgets. */
export const STAGE_TUNING = {
  /** Above this device pixel ratio the canvases keep this ratio, to limit their memory. */
  maxDpr: 2,
  /** Free room around the image when the view fits it, in CSS px. */
  fitPadding: 40,
  /** Fraction of the image that must stay inside the view while the user pans. */
  panKeepVisible: 0.15,
  /** A right drag longer than this (CSS px) pans instead of a right click. */
  altPanThresholdPx: 4,
  /** Side of one checkerboard square, in CSS px. */
  checkerPx: 8,
  /** Hard drop shadow under the stage, in CSS px. */
  frameShadowPx: 6,
  /** Side of the largest display tile of a layer, in image px. */
  maxTilePx: 4096,
  /** Thickness of a ruler strip, in CSS px. */
  rulerPx: 20,
  zoom: {
    /** 3200%. */
    max: 32,
    /** Smallest zoom, as a fraction of the zoom that fits the image. */
    minFitRatio: 0.35,
    /** The first view and "fit" never go above this zoom, so a small icon does not fill the screen. */
    fitMax: 16,
    /** Image smoothing is off from this zoom on, so each pixel shows as a hard square. */
    pixelatedFrom: 2,
    /** Speed of the smooth zoom (larger is faster). */
    smoothing: 22,
    /** Zoom factor per wheel delta unit: exp(-delta * wheelSensitivity). */
    wheelSensitivity: 0.0022,
    /** The largest wheel delta of one event, so a fast flick does not jump too far. */
    wheelMaxDelta: 240,
    /** One zoom-in or zoom-out step of a button or key. */
    step: 1.6,
    /** The zoom levels of the Zoom tool clicks. */
    steps: [0.02, 0.03, 0.05, 1 / 12, 0.125, 1 / 6, 0.25, 1 / 3, 0.5, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32],
  },
} as const;
