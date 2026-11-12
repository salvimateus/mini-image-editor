import { ADJUST_PARAMS } from './adjust.ts';
import { EXPORT_PARAMS } from './export.ts';
import { ASPECT_PARAMS, HISTORY_PARAMS, LIMITS_PARAMS, MASK_PARAMS } from './limits.ts';
import { PAINT_PARAMS } from './paint.ts';
import { RESAMPLE_PARAMS } from './resample.ts';

/** Every algorithm constant. Each feature file owns one section. Game-feel constants live in TUNING. */
export const PARAMS = {
  limits: LIMITS_PARAMS,
  history: HISTORY_PARAMS,
  mask: MASK_PARAMS,
  aspect: ASPECT_PARAMS,
  paint: PAINT_PARAMS,
  resample: RESAMPLE_PARAMS,
  adjust: ADJUST_PARAMS,
  export: EXPORT_PARAMS,
} as const;
