/** Size limits of a document and of each decoded image. */
export const LIMITS_PARAMS = {
  /** Largest side of an image or of the stage, in pixels. */
  maxSide: 16_384,
  /** Largest area of an image or of the stage, in pixels. */
  maxPixels: 50_000_000,
  /** Above this area the app warns that the work can be slow. */
  warnPixels: 25_000_000,
} as const;

/** Undo history limits. */
export const HISTORY_PARAMS = {
  /** Largest sum of the bytes that the undo and redo entries keep. */
  budgetBytes: 512 * 1024 * 1024,
  /** Largest number of undo steps. */
  maxSteps: 200,
} as const;

/** Selection masks. */
export const MASK_PARAMS = {
  /** Box blur passes of a feather; three passes give a near-gaussian falloff. */
  featherPasses: 3,
  /** Largest feather radius, in pixels. */
  maxFeather: 250,
  /** Sub-samples per axis for the anti-aliased polygon edge. */
  polygonSubsamples: 4,
} as const;

/** The aspect ratio label of the status bar. */
export const ASPECT_PARAMS = {
  /** A reduced ratio shows exactly ("16:9") when each term is at most this value. */
  maxExactTerm: 32,
  /** A ratio within this relative distance of a preset shows as "≈ preset". */
  nearTolerance: 0.01,
} as const;
