import { ADJUST_TUNING } from './adjust.ts';
import { EXPORT_TUNING } from './export.ts';
import { GEOMETRY_TUNING } from './geometry.ts';
import { PAINT_TUNING } from './paint.ts';
import { SELECT_TUNING } from './select.ts';
import { STAGE_TUNING } from './stage.ts';
import { SHAPES_TUNING } from './shapes.ts';
import { TEXT_TUNING } from './text.ts';
import { PARTICLE_TUNING, SFX_TUNING, UI_TUNING } from './ui.ts';

/** Every game-feel constant. Each feature file owns one section. Algorithm constants live in PARAMS. */
export const TUNING = {
  ui: UI_TUNING,
  particles: PARTICLE_TUNING,
  sfx: SFX_TUNING,
  stage: STAGE_TUNING,
  paint: PAINT_TUNING,
  select: SELECT_TUNING,
  geometry: GEOMETRY_TUNING,
  adjust: ADJUST_TUNING,
  text: TEXT_TUNING,
  shapes: SHAPES_TUNING,
  export: EXPORT_TUNING,
} as const;
