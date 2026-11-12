import type { Component } from 'svelte';
import type { ToolId } from '../../app/tools/types.ts';
import BucketOptions from './BucketOptions.svelte';
import CloneOptions from './CloneOptions.svelte';
import CropOptions from './CropOptions.svelte';
import MoveOptions from './MoveOptions.svelte';
import PaintOptions from './PaintOptions.svelte';
import SelectOptions from './SelectOptions.svelte';
import ShapeOptions from './ShapeOptions.svelte';
import StepOptions from './StepOptions.svelte';
import TextOptions from './TextOptions.svelte';

/** The options bar component of each tool; null for a tool with no options. PaintOptions reads app.tool for its settings. */
export const TOOL_OPTIONS: Record<ToolId, Component | null> = {
  move: MoveOptions,
  'marquee-rect': SelectOptions,
  'marquee-ellipse': SelectOptions,
  lasso: SelectOptions,
  wand: SelectOptions,
  crop: CropOptions,
  eyedropper: null,
  brush: PaintOptions,
  pencil: PaintOptions,
  eraser: PaintOptions,
  bucket: BucketOptions,
  clone: CloneOptions,
  text: TextOptions,
  shape: ShapeOptions,
  step: StepOptions,
  hand: null,
  zoom: null,
};
