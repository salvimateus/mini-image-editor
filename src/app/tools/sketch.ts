import { PARAMS } from '../../core/params/index.ts';
import { app } from '../state.svelte.ts';
import { createStrokeTool } from './brush.ts';
import type { ToolController } from './types.ts';

/** Dry media on a paper tooth (graphite, charcoal, chalk, crayon). The pen pressure changes the size, the color and the tooth depth. */
export const sketchTool: ToolController = createStrokeTool({
  id: 'sketch',
  mode: 'paint',
  aliased: false,
  sound: 'scratch',
  label: 'paint.history.sketch',
  hints: [
    { keys: 'Drag', text: 'paint.hint.sketch' },
    { keys: '[ ]', text: 'paint.hint.size' },
    { keys: 'Alt+Click', text: 'paint.hint.pick' },
    { keys: 'Shift+Click', text: 'paint.hint.line' },
    { keys: '', text: 'paint.hint.pressure' },
  ],
  texture() {
    const { hardness, ...texture } = PARAMS.paint.sketchPresets[app.brush.sketch.preset];
    return { hardness, texture };
  },
});
