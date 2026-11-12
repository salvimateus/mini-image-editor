import { cleanVignette } from '../core/adjust/index.ts';
import { PARAMS } from '../core/params/index.ts';
import type { FrameParams, ResampleMethod, VignetteParams } from '../core/types.ts';
import type { StageFill } from './actions/geometry.ts';
import { DEFAULT_GRID, type GridSpec } from './doc.svelte.ts';
import { boolField, colorField, numField, pickField, readPrefs, savePrefs } from './prefs.ts';
import type { CropFill, CropMode } from './tools/crop.ts';
import { TUNING } from './tuning/index.ts';

// The last values that the user applied in the panels and dialogs: the start values of their next use. Each value is
// read when its panel or dialog opens, so a reset of the settings shows at the next opening.

const VERSION = 1;

const KEYS = {
  frame: 'adjust.frame',
  vignette: 'adjust.vignette',
  sharpen: 'adjust.sharpen',
  crop: 'geometry.crop',
  canvas: 'geometry.canvas',
  imageSize: 'geometry.image-size',
  newImage: 'new-image',
  grid: 'grid',
} as const;

// ----- frame -----

export interface FrameStart { params: FrameParams; grow: boolean }

export function lastFrame(): FrameStart {
  const tuning = TUNING.adjust.frame;
  const stored = readPrefs(KEYS.frame, VERSION);
  return {
    params: {
      width: numField(stored?.width, tuning.width.default, tuning.width, true),
      color: colorField(stored?.color, tuning.defaultColor, true),
    },
    grow: boolField(stored?.grow, tuning.growDefault),
  };
}

export function saveFrame(params: FrameParams, grow: boolean): void {
  savePrefs(KEYS.frame, VERSION, { width: params.width, color: params.color, grow });
}

// ----- vignette -----

export function lastVignette(): VignetteParams {
  const d = TUNING.adjust.vignette.defaults;
  const stored = readPrefs(KEYS.vignette, VERSION);
  const n = (key: keyof VignetteParams) => numField(stored?.[key], d[key], { min: -Infinity, max: Infinity });
  return cleanVignette({ amount: n('amount'), size: n('size'), roundness: n('roundness'), feather: n('feather') });
}

export function saveVignette(params: VignetteParams): void {
  savePrefs(KEYS.vignette, VERSION, params);
}

// ----- sharpen -----

/** The advanced values of Sharpen; the steps always start at 0. */
export interface SharpenStart { radius: number; threshold: number }

export function lastSharpen(): SharpenStart {
  const limits = PARAMS.adjust.sharpen;
  const stored = readPrefs(KEYS.sharpen, VERSION);
  return {
    radius: Math.round(numField(stored?.radius, limits.radius.default, limits.radius) * 10) / 10,
    threshold: numField(stored?.threshold, limits.threshold.default, limits.threshold, true),
  };
}

export function saveSharpen(start: SharpenStart): void {
  savePrefs(KEYS.sharpen, VERSION, start);
}

// ----- crop, canvas size, image size -----

const CROP_MODES: readonly CropMode[] = ['crop', 'expand'];
const CROP_FILLS: readonly CropFill[] = ['transparent', 'fg', 'bg'];
const STAGE_FILLS: readonly StageFill[] = ['transparent', 'white', 'black', 'fg', 'bg'];
const METHODS: readonly ResampleMethod[] = ['auto', 'smooth', 'sharp', 'nearest'];

export interface CropStart { mode: CropMode; fill: CropFill }

export const CROP_DEFAULTS: CropStart = { mode: 'crop', fill: 'transparent' };

export function lastCrop(): CropStart {
  const stored = readPrefs(KEYS.crop, VERSION);
  return { mode: pickField(stored?.mode, CROP_MODES, CROP_DEFAULTS.mode), fill: pickField(stored?.fill, CROP_FILLS, CROP_DEFAULTS.fill) };
}

export function saveCrop(start: CropStart): void {
  savePrefs(KEYS.crop, VERSION, start);
}

export function lastCanvasFill(): StageFill {
  return pickField(readPrefs(KEYS.canvas, VERSION)?.fill, STAGE_FILLS, 'transparent');
}

export function saveCanvasFill(fill: StageFill): void {
  savePrefs(KEYS.canvas, VERSION, { fill });
}

export function lastResample(): ResampleMethod {
  return pickField(readPrefs(KEYS.imageSize, VERSION)?.method, METHODS, 'auto');
}

export function saveResample(method: ResampleMethod): void {
  savePrefs(KEYS.imageSize, VERSION, { method });
}

// ----- new image -----

export type NewImageBackground = 'transparent' | 'white' | 'black';

export interface NewImageStart { width: number; height: number; background: NewImageBackground }

export function lastNewImage(): NewImageStart {
  const first = TUNING.ui.newImagePresets[0];
  const stored = readPrefs(KEYS.newImage, VERSION);
  const side = { min: 1, max: PARAMS.limits.maxSide };
  let width = numField(stored?.width, first.w, side, true);
  let height = numField(stored?.height, first.h, side, true);
  if (width * height > PARAMS.limits.maxPixels) {
    width = first.w;
    height = first.h;
  }
  return { width, height, background: pickField(stored?.background, ['transparent', 'white', 'black'] as const, 'white') };
}

export function saveNewImage(start: NewImageStart): void {
  savePrefs(KEYS.newImage, VERSION, start);
}

// ----- grid -----

/** The grid of the last document: a new document starts with it. */
export function lastGrid(): GridSpec {
  const limits = TUNING.geometry.gridLimits;
  const stored = readPrefs(KEYS.grid, VERSION);
  return {
    mode: pickField(stored?.mode, ['spacing', 'divisions'] as const, DEFAULT_GRID.mode),
    spacing: numField(stored?.spacing, DEFAULT_GRID.spacing, limits.spacing, true),
    cols: numField(stored?.cols, DEFAULT_GRID.cols, limits.cols, true),
    rows: numField(stored?.rows, DEFAULT_GRID.rows, limits.rows, true),
  };
}

export function saveGrid(grid: GridSpec): void {
  savePrefs(KEYS.grid, VERSION, { mode: grid.mode, spacing: grid.spacing, cols: grid.cols, rows: grid.rows });
}
