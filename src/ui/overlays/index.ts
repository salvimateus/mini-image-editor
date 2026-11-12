import { avatarOverlay } from './avatar.ts';
import { brushCursorOverlay } from './brush-cursor.ts';
import { cropOverlay } from './crop.ts';
import { gridOverlay } from './grid.ts';
import { guidesOverlay } from './guides.ts';
import { loupeOverlay } from './loupe.ts';
import { pixelGridOverlay } from './pixel-grid.ts';
import { selectionOverlay } from './selection.ts';
import { snapFlashOverlay } from './snap-flash.ts';
import { transformOverlay } from './transform.ts';
import type { SceneOverlay } from './types.ts';

export type { SceneOverlay } from './types.ts';

/** Every overlay of the fx canvas, one file each, sorted by z (draw order). */
export const OVERLAYS: readonly SceneOverlay[] = [
  pixelGridOverlay,
  gridOverlay,
  avatarOverlay,
  guidesOverlay,
  selectionOverlay,
  cropOverlay,
  transformOverlay,
  snapFlashOverlay,
  brushCursorOverlay,
  loupeOverlay,
].sort((a, b) => a.z - b.z);
