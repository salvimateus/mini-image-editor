import { renderFrame } from '../core/adjust/frame.ts';
import { renderVignette } from '../core/adjust/vignette.ts';
import type { FrameParams, RasterImage, VignetteParams } from '../core/types.ts';
import type { EditorDoc } from './doc.svelte.ts';
import type { RasterLayer } from './layers.ts';
import { app } from './state.svelte.ts';

/** A raster layer that the vignette generator draws; its pixels follow its params and the stage size. */
export type GeneratedLayer = RasterLayer & { generator: { kind: 'vignette'; params: VignetteParams } };

/** A raster layer that the frame generator draws: a border along the stage edges. */
export type FrameLayer = RasterLayer & { generator: { kind: 'frame'; params: FrameParams } };

/** True for a generated vignette layer. */
export function isGeneratedLayer(layer: unknown): layer is GeneratedLayer {
  const entry = layer as Partial<RasterLayer> | null;
  return !!entry && entry.kind === 'raster' && entry.generator?.kind === 'vignette';
}

export function isFrameLayer(layer: unknown): layer is FrameLayer {
  const entry = layer as Partial<RasterLayer> | null;
  return !!entry && entry.kind === 'raster' && entry.generator?.kind === 'frame';
}

/** The generated vignette layers of the document, bottom first. */
export function vignetteLayers(doc: EditorDoc): GeneratedLayer[] {
  return doc.layers.filter(isGeneratedLayer);
}

/** The generated frame layers of the document, bottom first. */
export function frameLayers(doc: EditorDoc): FrameLayer[] {
  return doc.layers.filter(isFrameLayer);
}

/** Where a new vignette goes in the stack: below the lowest frame, so the frame stays on top; else on top. */
export function vignetteInsertIndex(doc: EditorDoc): number {
  const index = doc.layers.findIndex(isFrameLayer);
  return index < 0 ? doc.layers.length : index;
}

/**
 * The vignette image at a stage size. A newer vignette request (the panel preview) makes the worker reply stale; the
 * image is then rendered here, so the caller always gets it.
 */
export async function vignetteImage(width: number, height: number, params: VignetteParams): Promise<RasterImage> {
  const image = await app.engine.vignette(width, height, params);
  return image ?? renderVignette(width, height, params);
}

/** The frame image at a stage size: an opaque border of params.width px (at most half of the shorter side). */
export function frameImage(width: number, height: number, params: FrameParams): RasterImage {
  return renderFrame(width, height, params);
}

/**
 * Prepares the new image of each generated layer (vignette, frame) for a new stage size. Call the returned function
 * inside the `doc.batch` that changes the stage size, after `setStage`: it puts each generated layer at 0, 0 of the new
 * stage.
 */
export async function prepareGenerators(doc: EditorDoc, width: number, height: number): Promise<() => void> {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const ready: { id: number; image: RasterImage }[] = [];
  for (const layer of vignetteLayers(doc)) {
    ready.push({ id: layer.id, image: await vignetteImage(w, h, layer.generator.params) });
  }
  for (const layer of frameLayers(doc)) {
    ready.push({ id: layer.id, image: frameImage(w, h, layer.generator.params) });
  }
  return () => {
    for (const { id, image } of ready) {
      const layer = doc.layer(id);
      if (isGeneratedLayer(layer)) doc.replaceImage(id, image, { x: 0, y: 0 }, 'adjust.history.vignette');
      else if (isFrameLayer(layer)) doc.replaceImage(id, image, { x: 0, y: 0 }, 'history.frame');
    }
  };
}
