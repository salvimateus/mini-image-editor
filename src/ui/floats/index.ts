import type { Component } from 'svelte';
import AlignBar from './AlignBar.svelte';
import SelectionBar from './SelectionBar.svelte';

/** Components of the DOM layer above the stage canvases. Each one reads app.stage and app.viewTick to follow the view. */
export const FLOATS: readonly Component[] = [SelectionBar, AlignBar];
