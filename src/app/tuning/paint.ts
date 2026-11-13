/** Game-feel constants of the paint feature: shortcut steps, cursor, loupe, sounds and bursts. */
export const PAINT_TUNING = {
  /** The `[` `]` size step grows with the size: the first band whose `below` is larger than the size gives the step. */
  sizeSteps: [
    { below: 10, step: 1 },
    { below: 50, step: 5 },
    { below: 100, step: 10 },
    { below: 200, step: 25 },
    { below: Number.POSITIVE_INFINITY, step: 50 },
  ],
  /** Shift+`[` `]` hardness step, 0..1. */
  hardnessStep: 0.1,
  /** The size (or hardness) label next to the cursor after a change, then a fade. */
  flash: { showMs: 700, fadeMs: 300 },
  /** A paint sound plays at most once in this interval during a drag. */
  strokeSoundMs: 90,
  /** The pressure of a mouse or a touch, which have none: a pressure tool then draws at a middle weight. */
  mousePressure: 0.6,
  cursor: {
    /** Below this screen radius the outline is replaced by a small cross. */
    minRingPx: 3,
    /** Arm length of the small cross and of the clone source cross, in CSS px. */
    crossPx: 6,
    sourceCrossPx: 9,
  },
  loupe: {
    /** Ring radius in CSS px. */
    radiusPx: 56,
    /** Pixels on each side of the ring: an odd number keeps the picked pixel in the center. */
    cells: 11,
    /** Width of the color ring around the enlarged pixels, in CSS px. */
    ringPx: 7,
    /** Space between the ring and the hex label, in CSS px. */
    labelGapPx: 8,
  },
  /** The burst in the fill color at a bucket click. */
  fillBurst: { count: 22, speed: [140, 340], life: [0.35, 0.7], size: [4, 9], jitter: 6 },
  /** The small pop at a color pick. */
  pickBurst: { count: 9, speed: [70, 170], life: [0.22, 0.42], size: [3, 6], jitter: 2 },
  /** Gravity of both bursts: low, so the dots float. */
  burstGravity: 260,
} as const;
