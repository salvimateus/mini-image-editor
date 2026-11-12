/** Algorithm constants of the adjust feature: the filters, the preview proxy and the vignette. */
export const ADJUST_PARAMS = {
  /** A layer with more pixels than this gets a smaller copy (proxy) for the previews of the whole layer. */
  proxyMaxPixels: 4_000_000,
  /** Number of progress events of one full-resolution commit. */
  progressSteps: 24,
  /** Rec. 601 luma weights: the luminance of the histogram, the auto levels and the sharpen. */
  luma: { r: 0.299, g: 0.587, b: 0.114 },
  hueSaturation: {
    /** Saturation +100 divides the saturation by this; it keeps gray gray and pushes each color near full saturation. */
    maxBoostDivisor: 0.04,
    /** Saturation of Colorize at the slider value 0; -100 and +100 give 0 and 1. */
    colorizeBase: 0.5,
  },
  levels: {
    gammaMin: 0.1,
    gammaMax: 9.99,
    /** Smallest distance between the input black and white points. */
    minInputSpan: 2,
    /** Auto levels clips this fraction of the luma at each end of the histogram. */
    autoClip: 0.001,
  },
  sharpen: {
    maxSteps: 10,
    /** Strength that each step adds to the unsharp mask (1 = 100%). */
    amountPerStep: 0.25,
    /** Gaussian sigma in px. */
    radius: { min: 0.3, max: 4, default: 1 },
    /** Smallest luminance detail (0..255) that the sharpen changes; smaller detail (noise) stays. */
    threshold: { min: 0, max: 64, default: 2 },
    /** Kernel half width in sigmas. */
    kernelSigmas: 3,
  },
  vignette: {
    /** The inner edge (where alpha starts) in units of the stage ellipse at size 0 and at size 100. */
    innerAtSize0: 0.2,
    innerAtSize100: 1.25,
    /** The width of the transition at feather 0 and at feather 100, in units of the stage ellipse. */
    featherMin: 0.03,
    featherMax: 1.1,
    /** Superellipse exponent at roundness -100: higher is closer to a rectangle. Roundness 0 is the ellipse (2). */
    squareExponent: 7,
    /** Side of the ordered dither matrix. */
    ditherSize: 8,
  },
} as const;
