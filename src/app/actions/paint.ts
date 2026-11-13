import { PARAMS } from '../../core/params/index.ts';
import { flashBrush } from '../../ui/overlays/brush-cursor.ts';
import { t } from '../i18n/index.ts';
import * as sfx from '../sfx.ts';
import { app, type BrushToolId } from '../state.svelte.ts';
import { TUNING } from '../tuning/index.ts';
import type { ActionHandlers, PaintActionId } from './types.ts';

const BRUSH_TOOLS: ReadonlySet<string> = new Set<BrushToolId>(['brush', 'pencil', 'eraser', 'clone', 'sketch']);

function activeBrush(): BrushToolId | null {
  if (BRUSH_TOOLS.has(app.tool)) return app.tool as BrushToolId;
  app.refuse(t('paint.toast.needBrush'));
  return null;
}

/** The next size on the grid of its band: the step grows with the size. */
export function nextBrushSize(size: number, direction: 1 | -1): number {
  const probe = direction > 0 ? size : size - 1;
  const band = TUNING.paint.sizeSteps.find((entry) => probe < entry.below) ?? TUNING.paint.sizeSteps[TUNING.paint.sizeSteps.length - 1];
  const step = band.step;
  const next = direction > 0 ? Math.floor(size / step) * step + step : Math.ceil(size / step) * step - step;
  return Math.max(TUNING.ui.brushSize.min, Math.min(PARAMS.paint.maxSize, next));
}

function changeSize(direction: 1 | -1): void {
  const tool = activeBrush();
  if (!tool) return;
  const current = Math.min(PARAMS.paint.maxSize, app.brush[tool].size);
  const next = app.setBrush(tool, { size: nextBrushSize(current, direction) });
  if (next.size !== current) sfx.play('tick');
  flashBrush(t('paint.flash.size', { size: next.size }));
}

function changeHardness(direction: 1 | -1): void {
  const tool = activeBrush();
  if (!tool) return;
  if (tool === 'pencil' || tool === 'sketch') {
    app.refuse(t(tool === 'pencil' ? 'paint.toast.pencilHard' : 'paint.toast.sketchHard'));
    return;
  }
  const step = TUNING.paint.hardnessStep;
  const current = app.brush[tool].hardness;
  const value = Math.round((current + direction * step) / step) * step;
  const next = app.setBrush(tool, { hardness: Math.max(0, Math.min(1, value)) });
  if (next.hardness !== current) sfx.play('tick');
  flashBrush(t('paint.flash.hardness', { value: Math.round(next.hardness * 100) }));
}

/** `[` `]` change the size and Shift+`[` `]` the hardness of the active brush tool. */
export const paintActions: ActionHandlers<PaintActionId> = {
  'paint.sizeDown': () => changeSize(-1),
  'paint.sizeUp': () => changeSize(1),
  'paint.hardnessDown': () => changeHardness(-1),
  'paint.hardnessUp': () => changeHardness(1),
};
