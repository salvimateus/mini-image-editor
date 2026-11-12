/** Game-feel constants of the shapes feature: shape and step defaults, option ranges, arrow proportions, handles. */
export const SHAPES_TUNING = {
  /** Transparent px around the geometry of a rendered shape, for the anti-aliased edge. */
  padPx: 2,
  /** The smallest side of a rectangle or an ellipse, the shortest arrow and the smallest step, in document px. */
  minPx: 4,
  minArrowPx: 8,
  /** A click with no drag makes a shape of this size (document px), centered at the click. */
  clickSize: { w: 200, h: 120, arrow: 160 },
  /** A press that moves less than this (screen px) is a click, not a drag. */
  clickSlopPx: 3,
  /** Shift holds an arrow to steps of this angle, in degrees. */
  angleStepDeg: 45,
  /** Thin arrow head, from the line width: length = base + perSize * size; width likewise. */
  thinHead: { length: { base: 10, perSize: 2.6 }, width: { base: 8, perSize: 2.4 } },
  /** Thick arrow head, from the body width. */
  thickHead: { length: 1.3, width: 2.4 },
  /** The head takes at most this part of the arrow length; a short arrow gets a smaller head. */
  headMaxShare: 0.6,
  /** Step number: the font weight, and the font size for 1, 2 and 3 or more digits as a part of the diameter. */
  stepFont: { weight: 800, scale: [0.6, 0.48, 0.38], fit: 0.78 },
  /** Step drop shadow: offset down and blur as a part of the diameter, with a floor in px. */
  stepShadow: { color: 'rgba(0, 0, 0, 0.45)', offset: 0.06, minOffsetPx: 1, blur: 0.16, minBlurPx: 2 },
  /** Wait at most this long for the UI font before a step renders with the fallback font. */
  fontTimeoutMs: 3000,
  ranges: {
    strokeWidth: { min: 0, max: 40, step: 1 },
    radius: { min: 0, max: 200, step: 1 },
    thinSize: { min: 1, max: 40, step: 1 },
    thickSize: { min: 4, max: 160, step: 1 },
    stepSize: { min: 16, max: 240, step: 1 },
    stepStroke: { min: 0, max: 20, step: 1 },
    stepNumber: { min: 0, max: 9999 },
  },
  /** The first settings, before the user changes them. Colors are '#rrggbb'. */
  defaults: {
    kind: 'rect',
    box: { strokeColor: '#FF0000', strokeWidth: 2, fillOn: false, fillColor: '#FFFFFF', radius: 0 },
    arrow: { color: '#FF0000', thinSize: 4, thickSize: 24, strokeColor: '#FFFFFF', strokeWidth: 0 },
    step: { size: 40, fill: '#FF0000', textColor: '#FFFFFF', strokeColor: '#FFFFFF', strokeWidth: 2, shadow: true },
  },
  /** Shape handles: the drawn side and the half side of the hit area, in screen px. */
  handle: { sizePx: 10, hitPx: 9 },
  /** A visible pixel of a shape within this distance (screen px) counts as a hit, capped in document px. */
  hit: { reachPx: 6, maxReachPx: 48 },
  /** A held drag with no motion keeps its undo step open by pushing the same state again at this interval. */
  keepAliveMs: 300,
  /** The pop of a new shape or step. */
  createBurst: { count: 12, speed: [70, 180], life: [0.25, 0.45], size: [3, 6] },
} as const;
