/** Game-feel constants of selection, layers, move, transform and align. */
export const SELECT_TUNING = {
  /** A press that moves less than this (screen px) is a click, not a drag. */
  clickSlopPx: 3,
  /** The lasso keeps a new point only this far (screen px) from the last one. */
  lassoStepPx: 2,
  /** Marching ants: the dash length and the step of each tick, in screen px, at a low frame rate. */
  ants: { fps: 8, dashPx: 5, stepPx: 2 },
  /** The largest feather of the options bar, in document px. */
  featherMax: 100,
  defaults: { mode: 'replace', feather: 0, tolerance: 32, contiguous: true },
  /** Floating bars: the gap from the bounds and the margin from the stage edges, in screen px. */
  bar: { gapPx: 12, edgePx: 8 },
  /** Transform handles: the drawn side and the half side of the hit area, in screen px. */
  handle: { sizePx: 10, hitPx: 10 },
  /** The size label under the transform box, in screen px. */
  sizeLabel: { gapPx: 10, padPx: 6, heightPx: 20, font: '800 12px "Nunito Variable", "Nunito", system-ui, sans-serif' },
  /** The Move tool picks a shape layer within this distance (screen px) of its pixels, capped in document px. */
  shapeHit: { hitPx: 6, maxReachPx: 48 },
  /** The smallest side of a transform box, in document px. */
  transformMinPx: 1,
  /** Arrow keys move the layer this far, in document px; Shift uses `big`. */
  nudge: { small: 1, big: 10 },
  /** Layer thumbnails: the side of the box in CSS px, the delay after a change, and the samples per axis of one thumbnail px. */
  thumb: { sizePx: 40, delayMs: 260, samples: 2 },
  /** The pop of a new row of the Layers panel. */
  rowPopMs: 240,
  /** A row drag in the Layers panel starts after this distance, in CSS px. */
  rowDragPx: 4,
} as const;
