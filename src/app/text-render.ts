import { toCss } from '../core/color.ts';
import { PARAMS } from '../core/params/index.ts';
import { createRaster } from '../core/raster.ts';
import type { Point, RasterImage, TextSpec } from '../core/types.ts';
import { BUNDLED_FAMILY, familyInfo, fitStyle, fontReady, fontShorthand, loadFont, quoteFamily, type FontStatus } from './fonts/fonts.ts';
import { cloneTextSpec, type TextLayer } from './layers.ts';

/**
 * Where the text sits inside its rendered image, in image px. (ax, ay) is the anchor: the left, center or right of
 * the text box (by the alignment) and its top. boxX and boxW give the text box, without the outline and the shadow.
 */
export interface TextPlacement {
  ax: number;
  ay: number;
  boxX: number;
  boxW: number;
}

interface Line {
  text: string;
  /** Advance width, without the spacing after the last character. */
  width: number;
  /** Left of the line in the text box. */
  x: number;
  baseline: number;
  /** The x of each grapheme from the line start, when the canvas has no letterSpacing. */
  glyphs: { text: string; x: number }[] | null;
}

interface Layout {
  lines: Line[];
  font: string;
  spacing: number;
  native: boolean;
  width: number;
  /** Ink and effects, in text box coordinates. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The placement of each image that this module rendered. */
const placements = new WeakMap<RasterImage, TextPlacement>();

let measureCtx: CanvasRenderingContext2D | null = null;

function context2d(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas context.');
  return ctx;
}

function measurer(): CanvasRenderingContext2D {
  measureCtx ??= context2d(1, 1);
  return measureCtx;
}

function hasLetterSpacing(ctx: CanvasRenderingContext2D): boolean {
  return 'letterSpacing' in ctx;
}

const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (part) => part.segment) : Array.from(text);
}

/** The text as the case option shows it. */
export function transformText(text: string, transform: TextSpec['transform']): string {
  switch (transform) {
    case 'upper':
      return text.toLocaleUpperCase();
    case 'lower':
      return text.toLocaleLowerCase();
    case 'capitalize':
      return text.replace(/(^|[\s([{"'«“\-/])(\p{L})/gu, (_match, before: string, letter: string) => before + letter.toLocaleUpperCase());
    default:
      return text;
  }
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** The family that the canvas draws with: the family when its style is loaded, else the bundled family. */
function drawFamily(spec: TextSpec, status: FontStatus): string {
  return status === 'ready' ? spec.family : BUNDLED_FAMILY;
}

function fontOf(spec: TextSpec, family: string): string {
  const info = familyInfo(family);
  const style = info ? fitStyle(info, spec.weight, spec.italic) : { weight: spec.weight, italic: spec.italic };
  const fallback = family === BUNDLED_FAMILY ? '' : `, ${quoteFamily(BUNDLED_FAMILY)}`;
  return `${fontShorthand(family, style.weight, style.italic, spec.size)}${fallback}, sans-serif`;
}

/** The outline and the shadow around the ink, on each side. */
function effectMargins(spec: TextSpec): { left: number; right: number; top: number; bottom: number } {
  const stroke = spec.stroke.on ? Math.max(0, spec.stroke.width) : 0;
  const out = { left: stroke, right: stroke, top: stroke, bottom: stroke };
  if (spec.shadow.on && spec.shadow.color.a > 0) {
    // A canvas shadow blur has a sigma of half the blur value; three sigmas hold the visible part.
    const blur = Math.ceil(Math.max(0, spec.shadow.blur) * 1.5);
    out.left = Math.max(out.left, stroke + blur - spec.shadow.dx);
    out.right = Math.max(out.right, stroke + blur + spec.shadow.dx);
    out.top = Math.max(out.top, stroke + blur - spec.shadow.dy);
    out.bottom = Math.max(out.bottom, stroke + blur + spec.shadow.dy);
  }
  // One more pixel on each side for the anti-aliased edge.
  return { left: out.left + 1, right: out.right + 1, top: out.top + 1, bottom: out.bottom + 1 };
}

function layoutText(ctx: CanvasRenderingContext2D, spec: TextSpec, family: string): Layout {
  const font = fontOf(spec, family);
  const native = hasLetterSpacing(ctx);
  const spacing = spec.letterSpacing;
  ctx.font = font;
  if (native) ctx.letterSpacing = '0px';
  const probe = ctx.measureText('Hg');
  const ascent = probe.fontBoundingBoxAscent || spec.size * 0.8;
  const descent = probe.fontBoundingBoxDescent || spec.size * 0.2;
  const advance = spec.size * spec.lineHeight;
  const halfLeading = (advance - (ascent + descent)) / 2;
  const texts = splitLines(transformText(spec.text, spec.transform));
  const lines: Line[] = [];
  let inkMinX = Infinity;
  let inkMaxX = -Infinity;
  let inkMinY = Infinity;
  let inkMaxY = -Infinity;
  let width = 0;
  const widths: number[] = [];
  const inks: { left: number; right: number; up: number; down: number }[] = [];
  for (const text of texts) {
    const parts = graphemes(text);
    const plain = ctx.measureText(text);
    const extra = parts.length > 1 ? spacing * (parts.length - 1) : 0;
    let glyphs: Line['glyphs'] = null;
    if (!native && spacing !== 0 && parts.length > 1) {
      glyphs = [];
      let prefix = '';
      for (let i = 0; i < parts.length; i++) {
        glyphs.push({ text: parts[i], x: ctx.measureText(prefix).width + spacing * i });
        prefix += parts[i];
      }
    }
    const lineWidth = text ? plain.width + extra : 0;
    widths.push(lineWidth);
    inks.push({
      left: text ? plain.actualBoundingBoxLeft : 0,
      right: text ? plain.actualBoundingBoxRight + extra : 0,
      up: text ? plain.actualBoundingBoxAscent : 0,
      down: text ? plain.actualBoundingBoxDescent : 0,
    });
    width = Math.max(width, lineWidth);
    lines.push({ text, width: lineWidth, x: 0, baseline: 0, glyphs });
  }
  lines.forEach((line, i) => {
    line.x = spec.align === 'center' ? (width - line.width) / 2 : spec.align === 'right' ? width - line.width : 0;
    line.baseline = i * advance + halfLeading + ascent;
    if (!line.text) return;
    const ink = inks[i];
    inkMinX = Math.min(inkMinX, line.x - ink.left);
    inkMaxX = Math.max(inkMaxX, line.x + ink.right);
    inkMinY = Math.min(inkMinY, line.baseline - ink.up);
    inkMaxY = Math.max(inkMaxY, line.baseline + ink.down);
  });
  const height = lines.length * advance;
  const margins = effectMargins(spec);
  return {
    lines,
    font,
    spacing,
    native,
    width,
    minX: Math.min(0, Number.isFinite(inkMinX) ? inkMinX : 0) - margins.left,
    maxX: Math.max(width, Number.isFinite(inkMaxX) ? inkMaxX : 0) + margins.right,
    minY: Math.min(0, Number.isFinite(inkMinY) ? inkMinY : 0) - margins.top,
    maxY: Math.max(height, Number.isFinite(inkMaxY) ? inkMaxY : 0) + margins.bottom,
  };
}

/** The image size and the placement of the text box in it: the ink and the effects, with no extra space. */
function frame(spec: TextSpec, layout: Layout): { width: number; height: number; placement: TextPlacement } {
  const anchorInBox = spec.align === 'center' ? layout.width / 2 : spec.align === 'right' ? layout.width : 0;
  // Whole pixels from the anchor to each edge, so the anchor sits on a pixel corner and a layer that keeps it never drifts.
  const left = Math.max(0, Math.ceil(anchorInBox - layout.minX));
  const right = Math.max(0, Math.ceil(layout.maxX - anchorInBox));
  const top = Math.max(0, Math.ceil(-layout.minY));
  const bottom = Math.max(0, Math.ceil(layout.maxY));
  const { maxSide, maxPixels } = PARAMS.limits;
  const width = Math.min(maxSide, Math.max(1, left + right));
  const height = Math.min(maxSide, Math.max(1, top + bottom), Math.max(1, Math.floor(maxPixels / width)));
  return { width, height, placement: { ax: left, ay: top, boxX: left - anchorInBox, boxW: layout.width } };
}

function drawLines(ctx: CanvasRenderingContext2D, layout: Layout, ox: number, oy: number, mode: 'stroke' | 'fill'): void {
  for (const line of layout.lines) {
    if (!line.text) continue;
    const x = ox + line.x;
    const y = oy + line.baseline;
    if (line.glyphs) {
      for (const glyph of line.glyphs) {
        if (mode === 'stroke') ctx.strokeText(glyph.text, x + glyph.x, y);
        else ctx.fillText(glyph.text, x + glyph.x, y);
      }
    } else if (mode === 'stroke') ctx.strokeText(line.text, x, y);
    else ctx.fillText(line.text, x, y);
  }
}

function paintText(ctx: CanvasRenderingContext2D, spec: TextSpec, layout: Layout, ox: number, oy: number): void {
  ctx.font = layout.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (layout.native) ctx.letterSpacing = `${layout.spacing}px`;
  if (spec.stroke.on && spec.stroke.width > 0) {
    // The fill covers the inner half of the stroke, so the visible outline is `width` wide.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = spec.stroke.width * 2;
    ctx.strokeStyle = toCss(spec.stroke.color);
    drawLines(ctx, layout, ox, oy, 'stroke');
  }
  ctx.fillStyle = toCss(spec.color);
  drawLines(ctx, layout, ox, oy, 'fill');
}

function emptyImage(): RasterImage {
  const image = createRaster(1, 1);
  placements.set(image, { ax: 0, ay: 0, boxX: 0, boxW: 0 });
  return image;
}

/** Renders now with `family`, which must be loaded. The image is generated, so its pixels can be read from the canvas. */
function draw(spec: TextSpec, family: string): RasterImage {
  if (!spec.text) return emptyImage();
  const layout = layoutText(measurer(), spec, family);
  const { width, height, placement } = frame(spec, layout);
  const ctx = context2d(width, height);
  const ox = placement.boxX;
  const oy = placement.ay;
  const shadow = spec.shadow;
  if (shadow.on && shadow.color.a > 0) {
    // The outline and the fill go on their own canvas first, so that they cast one shadow together.
    const art = context2d(width, height);
    paintText(art, spec, layout, ox, oy);
    ctx.shadowColor = toCss(shadow.color);
    ctx.shadowBlur = Math.max(0, shadow.blur);
    ctx.shadowOffsetX = shadow.dx;
    ctx.shadowOffsetY = shadow.dy;
    ctx.drawImage(art.canvas, 0, 0);
  } else {
    paintText(ctx, spec, layout, ox, oy);
  }
  const pixels = ctx.getImageData(0, 0, width, height);
  const image: RasterImage = { width, height, data: pixels.data };
  placements.set(image, placement);
  return image;
}

function safeDraw(spec: TextSpec, family: string): RasterImage {
  try {
    return draw(spec, family);
  } catch {
    return emptyImage();
  }
}

/** Loads the font (or the bundled one when it fails), then renders. The status says which font the image uses. */
export async function renderTextWithStatus(spec: TextSpec): Promise<{ image: RasterImage; status: FontStatus }> {
  if (!spec.text) return { image: emptyImage(), status: 'ready' };
  const shown = transformText(spec.text, spec.transform);
  let status: FontStatus = 'offline';
  try {
    status = await loadFont(spec.family, spec.weight, spec.italic, shown);
  } catch {
    status = 'offline';
  }
  if (status !== 'ready' && spec.family !== BUNDLED_FAMILY) {
    try {
      await loadFont(BUNDLED_FAMILY, spec.weight, spec.italic, shown);
    } catch {
      // The canvas falls back to a system font.
    }
  }
  return { image: safeDraw(spec, drawFamily(spec, status)), status };
}

/** Loads the font, then renders. Never rejects: it uses the bundled font on a failure. */
export async function renderTextLayer(spec: TextSpec): Promise<RasterImage> {
  return (await renderTextWithStatus(spec)).image;
}

/** A render with no wait, or null when the font of the spec is not loaded yet. */
export function renderTextNow(spec: TextSpec): RasterImage | null {
  if (!spec.text) return emptyImage();
  if (!fontReady(spec.family, spec.weight, spec.italic, transformText(spec.text, spec.transform))) return null;
  return safeDraw(spec, spec.family);
}

/** Size, letter spacing, outline width and shadow scaled by `factor`. */
export function scaleTextSpec(spec: TextSpec, factor: number): TextSpec {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const round = (value: number) => Math.round(value * 100) / 100;
  const out = cloneTextSpec(spec);
  out.size = Math.max(1, round(spec.size * f));
  out.letterSpacing = round(spec.letterSpacing * f);
  out.stroke.width = round(spec.stroke.width * f);
  out.shadow.blur = round(spec.shadow.blur * f);
  out.shadow.dx = round(spec.shadow.dx * f);
  out.shadow.dy = round(spec.shadow.dy * f);
  return out;
}

/** The placement of a text image. An image that this module did not render (a copy) is measured again. */
export function placementOf(image: RasterImage, spec: TextSpec): TextPlacement {
  const known = placements.get(image);
  if (known) return known;
  if (!spec.text) return { ax: 0, ay: 0, boxX: 0, boxW: 0 };
  try {
    const family = fontReady(spec.family, spec.weight, spec.italic) ? spec.family : BUNDLED_FAMILY;
    const placement = frame(spec, layoutText(measurer(), spec, family)).placement;
    placements.set(image, placement);
    return placement;
  } catch {
    return { ax: 0, ay: 0, boxX: 0, boxW: 0 };
  }
}

/** The anchor of a text layer in document px: the left, center or right of its text box (by the alignment) and its top. */
export function textAnchor(layer: TextLayer, align: TextSpec['align'] = layer.spec.align): Point {
  const placement = placementOf(layer.image, layer.spec);
  const left = layer.x + placement.boxX;
  const x = align === 'center' ? left + placement.boxW / 2 : align === 'right' ? left + placement.boxW : left;
  return { x: Math.round(x), y: layer.y + placement.ay };
}

/** The top-left corner (document px) that puts the anchor of `image` at `anchor`. */
export function placeText(anchor: Point, image: RasterImage, spec: TextSpec): Point {
  const placement = placementOf(image, spec);
  return { x: Math.round(anchor.x - placement.ax), y: Math.round(anchor.y - placement.ay) };
}
