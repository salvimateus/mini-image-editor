import { cloneRaster, opaqueBounds } from '../core/raster.ts';
import type { RasterImage, Rect, TextSpec, VignetteParams } from '../core/types.ts';

/** opacity 0..1; x and y = top-left corner in document px. */
export interface LayerBase { readonly id: number; name: string; visible: boolean; opacity: number; x: number; y: number }

export interface RasterLayer extends LayerBase { kind: 'raster'; image: RasterImage; generator?: { kind: 'vignette'; params: VignetteParams } }

/** image = render cache of the spec. */
export interface TextLayer extends LayerBase { kind: 'text'; spec: TextSpec; image: RasterImage }

export type Layer = RasterLayer | TextLayer;

let lastLayerId = 0;

/** A new id, unique in this session. */
export function nextLayerId(): number {
  lastLayerId += 1;
  return lastLayerId;
}

export function createRasterLayer(name: string, image: RasterImage, x = 0, y = 0): RasterLayer {
  return { id: nextLayerId(), kind: 'raster', name, visible: true, opacity: 1, x: Math.round(x), y: Math.round(y), image };
}

export function createTextLayer(name: string, spec: TextSpec, image: RasterImage, x: number, y: number): TextLayer {
  return { id: nextLayerId(), kind: 'text', name, visible: true, opacity: 1, x: Math.round(x), y: Math.round(y), spec: cloneTextSpec(spec), image };
}

/** A copy with a new id and its own pixels: painting one never changes the other. */
export function duplicateLayer(layer: Layer, name: string): Layer {
  const base = { id: nextLayerId(), name, visible: layer.visible, opacity: layer.opacity, x: layer.x, y: layer.y };
  if (layer.kind === 'text') return { ...base, kind: 'text', spec: cloneTextSpec(layer.spec), image: cloneRaster(layer.image) };
  const generator = layer.generator ? { kind: layer.generator.kind, params: { ...layer.generator.params } } : undefined;
  return { ...base, kind: 'raster', image: cloneRaster(layer.image), ...(generator ? { generator } : {}) };
}

export function cloneTextSpec(spec: TextSpec): TextSpec {
  return { ...spec, color: { ...spec.color }, stroke: { ...spec.stroke, color: { ...spec.stroke.color } }, shadow: { ...spec.shadow, color: { ...spec.shadow.color } } };
}

/** The full image rect of the layer, in document px. */
export function layerRect(layer: Layer): Rect {
  return { x: layer.x, y: layer.y, w: layer.image.width, h: layer.image.height };
}

/** The rect of the pixels with alpha > 0, in document px, or null for a fully transparent layer. */
export function visibleBounds(layer: Layer): Rect | null {
  const bounds = opaqueBounds(layer.image);
  return bounds ? { x: bounds.x + layer.x, y: bounds.y + layer.y, w: bounds.w, h: bounds.h } : null;
}
