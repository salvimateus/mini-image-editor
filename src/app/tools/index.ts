import { brushTool } from './brush.ts';
import { bucketTool } from './bucket.ts';
import { cloneTool } from './clone.ts';
import { cropTool } from './crop.ts';
import { eraserTool } from './eraser.ts';
import { eyedropperTool } from './eyedropper.ts';
import { handTool } from './hand.ts';
import { lassoTool } from './lasso.ts';
import { marqueeEllipseTool } from './marquee-ellipse.ts';
import { marqueeRectTool } from './marquee-rect.ts';
import { moveTool } from './move.ts';
import { pencilTool } from './pencil.ts';
import { shapeTool } from './shape.ts';
import { stepTool } from './step.ts';
import { textTool } from './text.ts';
import type { ToolController, ToolId } from './types.ts';
import { wandTool } from './wand.ts';
import { zoomTool } from './zoom.ts';

export type { Hint, ToolController, ToolId } from './types.ts';

/** Every tool, one file each. The stage routes the pointer to TOOLS[app.tool] after the overlay chain. */
export const TOOLS: Record<ToolId, ToolController> = {
  move: moveTool,
  'marquee-rect': marqueeRectTool,
  'marquee-ellipse': marqueeEllipseTool,
  lasso: lassoTool,
  wand: wandTool,
  crop: cropTool,
  eyedropper: eyedropperTool,
  brush: brushTool,
  pencil: pencilTool,
  eraser: eraserTool,
  bucket: bucketTool,
  clone: cloneTool,
  text: textTool,
  shape: shapeTool,
  step: stepTool,
  hand: handTool,
  zoom: zoomTool,
};
