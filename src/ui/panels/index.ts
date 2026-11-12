import type { Component } from 'svelte';
import type { PanelId } from '../../app/state.svelte.ts';
import Frame from './Frame.svelte';
import HueSaturation from './HueSaturation.svelte';
import Levels from './Levels.svelte';
import Sharpen from './Sharpen.svelte';
import TextPanel from './TextPanel.svelte';
import Vignette from './Vignette.svelte';

/** The panel that `app.panel` opens above the Color and Layers panels. */
export const PANELS: Record<Exclude<PanelId, 'none'>, Component> = {
  'hue-saturation': HueSaturation,
  levels: Levels,
  sharpen: Sharpen,
  vignette: Vignette,
  text: TextPanel,
  frame: Frame,
};
