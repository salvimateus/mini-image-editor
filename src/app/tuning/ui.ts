/** Game-feel constants of the shared interface: toasts, dialogs, held buttons, tooltips, particles and sounds. */
export const UI_TUNING = {
  toastMs: 3800,
  toastErrorMs: 6000,
  /** A toast with an action button stays longer, so the user can reach the button. */
  toastActionMs: 7000,
  maxToasts: 4,
  /** The progress pill shows only for work that lasts longer than this. */
  progressDelayMs: 150,
  /** Two history entries with one coalesce key merge when they come inside this time. */
  coalesceMs: 600,
  /** A held step button or arrow repeats after this delay, at this interval. */
  hold: { delayMs: 380, repeatMs: 70 },
  /** A tooltip shows after this delay, this far from its element, and keeps this margin from the window edges. */
  tooltip: { delayMs: 450, gapPx: 8, edgePx: 8 },
  dropBurstCount: 18,
  confettiCount: 56,
  /**
   * The About dialog: the logo pops in after `logoDelayMs` and lands `logoPopMs` later with a burst; the text lines
   * follow, `staggerMs` apart. A press on the logo squashes it for `squashMs` with a smaller burst.
   */
  about: {
    logoDelayMs: 120,
    logoPopMs: 460,
    lineRiseMs: 280,
    lineStartMs: 300,
    staggerMs: 70,
    squashMs: 380,
    landBurstCount: 16,
    pressBurstCount: 10,
    burstColors: ['var(--primary)', 'var(--primary-hover)', 'var(--stage-yellow)', 'var(--primary-edge)', 'var(--text)'],
  },
  /**
   * The width of the right column that the user sets, in CSS px; `--panel-w` is the default. At the 960px minimum
   * window, `max` leaves 424px for the stage. An arrow key moves the edge by `keyStepPx`, Shift+arrow by
   * `keyStepBigPx`. A reset plays a pulse of `resetPulseMs` on the handle.
   */
  sideWidth: { min: 280, max: 480, keyStepPx: 16, keyStepBigPx: 64, resetPulseMs: 420 },
  /** The colors that the Color panel keeps, newest first. */
  recentColors: 12,
  /** The KeyHud shows a combo this long; a hint (a click that teaches the shortcut) stays longer. */
  keyHud: { pressMs: 1400, hintMs: 2600 },
  /** The undo and redo toast is shorter than a plain toast: it comes often. */
  undoToastMs: 1600,
  /** Brush size limits, in document px, and the default settings of each brush tool. */
  brushSize: { min: 1, max: 1000 },
  brushDefaults: {
    brush: { size: 24, hardness: 0.8, opacity: 1, shape: 'round' },
    pencil: { size: 1, hardness: 1, opacity: 1, shape: 'round' },
    eraser: { size: 32, hardness: 0.9, opacity: 1, shape: 'round' },
    clone: { size: 40, hardness: 0.6, opacity: 1, shape: 'round' },
    /** The pencil (`sketch`): the tip hardness comes from the preset; `sizes` is the start size of each preset. */
    sketch: {
      size: 4,
      hardness: 1,
      opacity: 1,
      shape: 'round',
      preset: '2b',
      sizes: { '2b': 4, '6b': 7, charcoal: 20, colored: 5, chalk: 24, crayon: 12 },
    },
  },
  bucketDefaults: { tolerance: 32, contiguous: true },
  viewDefaults: { rulers: false, guides: true, grid: false, snap: true, avatar: false, hud: true },
  exportDefaults: { format: 'png', jpegQuality: 92 },
  /** The zoom levels of the status bar menu, 1 = 100%. */
  zoomPresets: [0.5, 1, 2, 4],
  /** The presets of the new image dialog, in px. */
  newImagePresets: [
    { w: 1080, h: 1080 },
    { w: 1920, h: 1080 },
    { w: 1080, h: 1920 },
    { w: 512, h: 512 },
  ],
} as const;

export const PARTICLE_TUNING = {
  budget: 900,
  maxColors: 64,
  gravity: 900,
  sparkLifeS: 0.55,
} as const;

export const SFX_TUNING = {
  master: 0.4,
  /** Sounds that can come many times a second play at most once in each interval. */
  minIntervalMs: { paint: 70, erase: 80, tick: 40, snap: 90, pick: 60, select: 60, cancel: 80, error: 250 },
  /** After this many broken audio contexts (no audio device), the app stays silent. */
  maxContextFailures: 3,
} as const;
