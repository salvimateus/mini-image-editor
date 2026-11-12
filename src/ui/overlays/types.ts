import type { StageHost, StagePointer } from '../stage-renderer.ts';

export interface SceneOverlay {
  /** Draw order: a larger z draws later and gets the pointer first. */
  readonly z: number;
  /** Screen space (stage CSS px). Returns true to keep the loop alive. */
  drawFx(fx: CanvasRenderingContext2D, host: StageHost, now: number): boolean;
  /** true = this overlay owns the drag (guides, crop and transform handles). */
  pointerDown?(p: StagePointer): boolean;
  pointerMove?(p: StagePointer): void;
  pointerUp?(p: StagePointer): void;
}
