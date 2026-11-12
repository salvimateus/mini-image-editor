import { stepZoom } from '../../ui/camera.ts';
import type { StagePointer } from '../../ui/stage-renderer.ts';
import * as sfx from '../sfx.ts';
import { app } from '../state.svelte.ts';
import type { ToolController } from './types.ts';

/** One zoom step in (direction 1) or out (direction -1), with the image point under the pointer kept in place. */
function zoomStep(p: StagePointer, direction: 1 | -1): void {
  const stage = app.stage;
  if (!stage) return;
  stage.zoomTo(stepZoom(stage.camera.targetZoom, direction), p.sx, p.sy);
  sfx.play('tick');
}

/** A click zooms in at the pointer; Alt+click or a right click zooms out. */
export const zoomTool: ToolController = {
  id: 'zoom',
  hints: [
    { keys: 'Click', text: 'stage.hint.zoomIn' },
    { keys: 'Alt+Click', text: 'stage.hint.zoomOut' },
    { keys: 'Space+Drag', text: 'stage.hint.pan' },
  ],
  cursor: (p) => (p?.alt ? 'zoom-out' : 'zoom-in'),
  down(p) {
    zoomStep(p, p.alt ? -1 : 1);
    return false;
  },
  altClick(p) {
    zoomStep(p, -1);
  },
};
