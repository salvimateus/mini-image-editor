import type { TextKey } from '../i18n/index.ts';
import type { StagePointer } from '../../ui/stage-renderer.ts';

export type ToolId =
  | 'move'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'lasso'
  | 'wand'
  | 'crop'
  | 'eyedropper'
  | 'brush'
  | 'pencil'
  | 'eraser'
  | 'bucket'
  | 'clone'
  | 'text'
  | 'shape'
  | 'step'
  | 'hand'
  | 'zoom';

/** keys: 'Alt+Click', '[ ]', 'Space+Drag', 'Enter'. */
export interface Hint {
  keys: string;
  text: TextKey;
}

export interface ToolController {
  readonly id: ToolId;
  readonly hints: readonly Hint[];
  /** A CSS cursor; 'none' when an overlay draws the cursor. */
  cursor(p: StagePointer | null): string;
  /** A primary press. false = ignore it, 'pan' = the drag moves the view, true = the tool owns the drag. */
  down?(p: StagePointer): boolean | 'pan';
  move?(p: StagePointer): void;
  up?(p: StagePointer): void;
  hover?(p: StagePointer | null): void;
  /** A right click that did not turn into a pan. */
  altClick?(p: StagePointer): void;
  /** Enter, Esc, arrows; true = handled. */
  key?(e: KeyboardEvent): boolean;
  activate?(): void;
  /** Commits or cancels pending state. */
  deactivate?(): void;
}
