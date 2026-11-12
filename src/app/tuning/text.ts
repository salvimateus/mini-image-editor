/** Game-feel constants of the text feature: font loading, the font picker, the text box and the option ranges. */
export const TEXT_TUNING = {
  /** A font that does not load inside this time counts as offline; the render then uses the bundled font. */
  fontTimeoutMs: 8000,
  /** After a failed font request, the same style is not asked again for this long. */
  offlineRetryMs: 15_000,
  /** Picker row previews load in batches of this size, one batch per interval. */
  previewBatchSize: 10,
  previewBatchMs: 160,
  /** The picker waits for the scroll to rest this long before it asks for the previews of the rows in view. */
  previewSettleMs: 120,
  /** Height of one picker row, in CSS px, and the rows rendered above and below the view. */
  pickerRowPx: 40,
  pickerOverscan: 6,
  pickerHeightPx: 320,
  /** Families in the recent list. */
  recentMax: 8,
  /** A press on a text layer that moves less than this (screen px) is a click that opens the text for editing. */
  dragThresholdPx: 3,
  /** A spark burst at a new text point. */
  createBurst: { count: 10, speed: [60, 160], life: [0.25, 0.45], size: [3, 6] },
  ranges: {
    size: { min: 4, max: 600, step: 1 },
    letterSpacing: { min: -100, max: 400, step: 1 },
    lineHeight: { min: 0.5, max: 3, step: 0.05 },
    strokeWidth: { min: 1, max: 100, step: 1 },
    shadowOffset: { min: -200, max: 200, step: 1 },
    shadowBlur: { min: 0, max: 100, step: 1 },
  },
  /** The style of the first text, before the user picks one. */
  defaults: {
    family: 'Inter',
    weight: 700,
    italic: false,
    size: 72,
    letterSpacing: 0,
    lineHeight: 1.2,
    align: 'left',
    transform: 'none',
    stroke: { on: false, color: { r: 255, g: 255, b: 255, a: 255 }, width: 4 },
    shadow: { on: false, color: { r: 0, g: 0, b: 0, a: 128 }, blur: 8, dx: 4, dy: 4 },
  },
} as const;
