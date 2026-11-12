import type { ToolController } from './types.ts';

/** A drag moves the view. The stage shows the grabbing cursor while it pans. */
export const handTool: ToolController = {
  id: 'hand',
  hints: [
    { keys: 'Drag', text: 'stage.hint.handDrag' },
    { keys: 'Wheel', text: 'stage.hint.wheel' },
  ],
  cursor: () => 'grab',
  down: () => 'pan',
};
