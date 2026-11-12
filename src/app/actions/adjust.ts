import * as sfx from '../sfx.ts';
import { app, type PanelId } from '../state.svelte.ts';
import type { ActionHandlers, AdjustActionId } from './types.ts';

function open(id: Exclude<PanelId, 'none'>): () => void {
  return () => {
    if (app.panel === id) return;
    sfx.play('tool');
    app.openPanel(id);
  };
}

export const adjustActions: ActionHandlers<AdjustActionId> = {
  'adjust.hueSaturation': open('hue-saturation'),
  'adjust.levels': open('levels'),
  'adjust.sharpen': open('sharpen'),
  'adjust.vignette': open('vignette'),
  'adjust.frame': open('frame'),
};
