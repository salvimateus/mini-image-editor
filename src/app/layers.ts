import { cloneRaster, opaqueBounds } from '../core/raster.ts';
import type { FrameParams, RasterImage, Rect, ShapeSpec, TextSpec, VignetteParams } from '../core/types.ts';
import { t } from './i18n/index.ts';

/** opacity 0..1; x and y = top-left corner in document px. */
export interface LayerBase { readonly id: number; name: string; visible: boolean; opacity: number; x: number; y: number }

export type LayerGenerator = { kind: 'vignette'; params: VignetteParams } | { kind: 'frame'; params: FrameParams };

export interface RasterLayer extends LayerBase { kind: 'raster'; image: RasterImage; generator?: LayerGenerator }

/** image = render cache of the spec. */
export interface TextLayer extends LayerBase { kind: 'text'; spec: TextSpec; image: RasterImage }

/** image = render cache of the spec. */
export interface ShapeLayer extends LayerBase { kind: 'shape'; spec: ShapeSpec; image: RasterImage }

export type Layer = RasterLayer | TextLayer | ShapeLayer;

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

export function createShapeLayer(name: string, spec: ShapeSpec, image: RasterImage, x: number, y: number): ShapeLayer {
  return { id: nextLayerId(), kind: 'shape', name, visible: true, opacity: 1, x: Math.round(x), y: Math.round(y), spec: cloneShapeSpec(spec), image };
}

/** A copy with a new id and its own pixels: painting one never changes the other. */
export function duplicateLayer(layer: Layer, name: string): Layer {
  const base = { id: nextLayerId(), name, visible: layer.visible, opacity: layer.opacity, x: layer.x, y: layer.y };
  if (layer.kind === 'text') return { ...base, kind: 'text', spec: cloneTextSpec(layer.spec), image: cloneRaster(layer.image) };
  if (layer.kind === 'shape') return { ...base, kind: 'shape', spec: cloneShapeSpec(layer.spec), image: cloneRaster(layer.image) };
  const generator = layer.generator ? cloneGenerator(layer.generator) : undefined;
  return { ...base, kind: 'raster', image: cloneRaster(layer.image), ...(generator ? { generator } : {}) };
}

export function cloneTextSpec(spec: TextSpec): TextSpec {
  return { ...spec, color: { ...spec.color }, stroke: { ...spec.stroke, color: { ...spec.stroke.color } }, shadow: { ...spec.shadow, color: { ...spec.shadow.color } } };
}

export function cloneShapeSpec(spec: ShapeSpec): ShapeSpec {
  const stroke = { color: { ...spec.stroke.color }, width: spec.stroke.width };
  switch (spec.kind) {
    case 'rect':
    case 'ellipse':
      return { ...spec, stroke, fill: spec.fill ? { ...spec.fill } : null };
    case 'arrow':
      return { ...spec, stroke, fill: { ...spec.fill } };
    case 'step':
      return { ...spec, stroke, fill: { ...spec.fill }, textColor: { ...spec.textColor } };
  }
}

export function cloneGenerator(generator: LayerGenerator): LayerGenerator {
  if (generator.kind === 'frame') return { kind: 'frame', params: { width: generator.params.width, color: { ...generator.params.color } } };
  return { kind: 'vignette', params: { ...generator.params } };
}

/** The default layer name of a shape, by kind: 'Retângulo', 'Elipse', 'Seta' or 'Passo 3'. */
export function shapeLayerName(spec: ShapeSpec): string {
  switch (spec.kind) {
    case 'rect':
      return t('doc.rectName');
    case 'ellipse':
      return t('doc.ellipseName');
    case 'arrow':
      return t('doc.arrowName');
    case 'step':
      return t('doc.stepName', { n: spec.number });
  }
}

/** True for a layer whose pixels come from a spec or a generator: paint goes to a new layer above it. */
export function isRenderedLayer(layer: Layer): boolean {
  return layer.kind !== 'raster' || layer.generator !== undefined;
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
