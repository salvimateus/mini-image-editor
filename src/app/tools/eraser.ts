import { createStrokeTool, SIZE_HINTS } from './brush.ts';
import type { ToolController } from './types.ts';

/** Strokes that lower the alpha of the paint target, with hardness and opacity. */
export const eraserTool: ToolController = createStrokeTool({
  id: 'eraser',
  mode: 'erase',
  aliased: false,
  sound: 'erase',
  label: 'paint.history.eraser',
  hints: [
    { keys: 'Drag', text: 'paint.hint.erase' },
    ...SIZE_HINTS,
    { keys: 'Alt+Click', text: 'paint.hint.pick' },
    { keys: 'Shift+Click', text: 'paint.hint.line' },
  ],
});
