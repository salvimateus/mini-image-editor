import { createMarqueeTool } from './marquee-rect.ts';
import type { ToolController } from './types.ts';

export const marqueeEllipseTool: ToolController = createMarqueeTool('marquee-ellipse', 'ellipse');
