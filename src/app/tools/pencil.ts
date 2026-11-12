import { createStrokeTool } from './brush.ts';
import type { ToolController } from './types.ts';

/** Hard aliased strokes: every pixel is fully painted or left as it is. */
export const pencilTool: ToolController = createStrokeTool({
  id: 'pencil',
  mode: 'paint',
  aliased: true,
  sound: 'paint',
  label: 'paint.history.pencil',
  hints: [
    { keys: 'Drag', text: 'paint.hint.pencil' },
    { keys: '[ ]', text: 'paint.hint.size' },
    { keys: 'Alt+Click', text: 'paint.hint.pick' },
    { keys: 'Shift+Click', text: 'paint.hint.line' },
  ],
});
