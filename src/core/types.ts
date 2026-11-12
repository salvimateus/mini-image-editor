/** RGBA8, straight alpha (not premultiplied), row-major. */
export interface RasterImage { width: number; height: number; data: Uint8ClampedArray }

export interface Rect { x: number; y: number; w: number; h: number }

export interface Point { x: number; y: number }

/** Each channel 0..255. */
export interface Rgba { r: number; g: number; b: number; a: number }

/** The pixels of `rect` before and after an edit, RGBA8 row-major. */
export interface Patch { rect: Rect; before: Uint8ClampedArray; after: Uint8ClampedArray }

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'ico';

export interface ExportOptions { format: ExportFormat; jpegQuality: number; background: Rgba; icoSizes: readonly number[] }

export type ResampleMethod = 'auto' | 'smooth' | 'sharp' | 'nearest';

/** 256 bins each. */
export interface Histogram { r: Uint32Array; g: Uint32Array; b: Uint32Array; luma: Uint32Array }

export interface HueSaturationParams { hue: number; saturation: number; lightness: number; colorize: boolean }

export interface LevelsParams { channel: 'rgb' | 'r' | 'g' | 'b'; inBlack: number; gamma: number; inWhite: number; outBlack: number; outWhite: number }

export interface SharpenParams { steps: number; radius: number; threshold: number }

export interface VignetteParams { amount: number; size: number; roundness: number; feather: number }

export type AdjustOp =
  | { kind: 'hue-saturation'; params: HueSaturationParams }
  | { kind: 'levels'; params: LevelsParams }
  | { kind: 'sharpen'; params: SharpenParams };

export interface TextSpec {
  text: string;
  family: string;
  weight: number;
  italic: boolean;
  size: number;
  color: Rgba;
  letterSpacing: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  transform: 'none' | 'upper' | 'lower' | 'capitalize';
  stroke: { on: boolean; color: Rgba; width: number };
  shadow: { on: boolean; color: Rgba; blur: number; dx: number; dy: number };
  /** Wrap width in px; null or undefined = free text. */
  boxWidth?: number | null;
}

/** width 0 = no border. */
export interface StrokeStyle { color: Rgba; width: number }

/**
 * The geometry and look of a shape layer. An arrow runs from the tail (0, 0) to the head (dx, dy); its size is the
 * line width (thin) or the body width (thick) and its fill is the arrow color. The size of a step is its diameter.
 */
export type ShapeSpec =
  | { kind: 'rect'; w: number; h: number; radius: number; stroke: StrokeStyle; fill: Rgba | null }
  | { kind: 'ellipse'; w: number; h: number; stroke: StrokeStyle; fill: Rgba | null }
  | { kind: 'arrow'; dx: number; dy: number; style: 'thin' | 'thick'; size: number; fill: Rgba; stroke: StrokeStyle }
  | { kind: 'step'; number: number; size: number; fill: Rgba; stroke: StrokeStyle; textColor: Rgba; shadow?: boolean }; // shadow: a drop shadow under the badge; no value = on

export interface FrameParams { width: number; color: Rgba }
