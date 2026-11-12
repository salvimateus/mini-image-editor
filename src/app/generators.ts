import { renderVignette } from '../core/adjust/vignette.ts';
import type { RasterImage, VignetteParams } from '../core/types.ts';
import type { EditorDoc } from './doc.svelte.ts';
import type { RasterLayer } from './layers.ts';
import { app } from './state.svelte.ts';

/** A raster layer that a generator draws (the vignette); its pixels follow its params and the stage size. */
export type GeneratedLayer = RasterLayer & { generator: { kind: 'vignette'; params: VignetteParams } };

export function isGeneratedLayer(layer: unknown): layer is GeneratedLayer {
  const entry = layer as Partial<RasterLayer> | null;
  return !!entry && entry.kind === 'raster' && entry.generator?.kind === 'vignette';
}

/** The generated vignette layers of the document, bottom first. */
export function vignetteLayers(doc: EditorDoc): GeneratedLayer[] {
  return doc.layers.filter(isGeneratedLayer);
}

/**
 * The vignette image at a stage size. A newer vignette request (the panel preview) makes the worker reply stale; the
 * image is then rendered here, so the caller always gets it.
 */
export async function vignetteImage(width: number, height: number, params: VignetteParams): Promise<RasterImage> {
  const image = await app.engine.vignette(width, height, params);
  return image ?? renderVignette(width, height, params);
}

/**
 * Prepares the new image of each generated layer (vignette) for a new stage size. Call the returned function inside the
 * `doc.batch` that changes the stage size, after `setStage`: it puts each generated layer at 0, 0 of the new stage.
 */
export async function prepareGenerators(doc: EditorDoc, width: number, height: number): Promise<() => void> {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const ready: { id: number; image: RasterImage }[] = [];
  for (const layer of vignetteLayers(doc)) {
    ready.push({ id: layer.id, image: await vignetteImage(w, h, layer.generator.params) });
  }
  return () => {
    for (const { id, image } of ready) {
      if (isGeneratedLayer(doc.layer(id))) doc.replaceImage(id, image, { x: 0, y: 0 }, 'adjust.history.vignette');
    }
  };
}
