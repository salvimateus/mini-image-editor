/** Game-feel and product constants of the export feature: the live weight, the dialog and its celebration. */
export const EXPORT_TUNING = {
  /** The live weight of the status bar waits this long after the last edit. */
  estimateDelayMs: 700,
  /** Above this area the live weight shows the plain size first, as an upper limit, while the optimized size runs. */
  quickFromPixels: 1_000_000,
  /** The dialog encodes again this long after the last move of the quality slider. */
  qualityDelayMs: 300,
  /** The weights count up to their new value in this time. */
  countMs: 520,
  /** JPEG has no alpha: transparent areas become this color. */
  jpegBackground: { r: 255, g: 255, b: 255, a: 255 },
  /** The JPEG quality slider. */
  quality: { min: 1, max: 100, step: 1 },
  /** CSS colors of the save confetti: the palette greens and its two derived accents. */
  confettiColors: ['var(--primary)', 'var(--primary-hover)', 'var(--palette-pale)', 'var(--primary-edge)', 'var(--teal)', 'var(--yellow)'],
} as const;
