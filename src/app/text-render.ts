import { toCss } from '../core/color.ts';
import { PARAMS } from '../core/params/index.ts';
import { createRaster } from '../core/raster.ts';
import type { Point, RasterImage, Rect, TextSpec } from '../core/types.ts';
import { BUNDLED_FAMILY, familyInfo, fitStyle, fontReady, fontShorthand, loadFont, quoteFamily, type FontStatus } from './fonts/fonts.ts';
import { cloneTextSpec, type TextLayer } from './layers.ts';

/**
 * Where the text sits inside its rendered image, in image px. (ax, ay) is the anchor: the top of the text box and its
 * left, center or right by the alignment (always the left for an area text, so its box never moves). boxX, boxW and
 * boxH give the text box, without the outline and the shadow; the box top is at ay.
 */
export interface TextPlacement {
  ax: number;
  ay: number;
  boxX: number;
  boxW: number;
  boxH: number;
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
  height: number;
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

/** The wrap width of an area text, or null for a free text. */
export function areaWidth(spec: TextSpec): number | null {
  const width = spec.boxWidth;
  return typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : null;
}

/** The advance width of a line of the typed text, as the draw places it: case transform, then letter spacing. */
function lineWidth(ctx: CanvasRenderingContext2D, text: string, spec: TextSpec): number {
  if (!text) return 0;
  const shown = transformText(text, spec.transform);
  const count = graphemes(shown).length;
  return ctx.measureText(shown).width + (count > 1 ? spec.letterSpacing * (count - 1) : 0);
}

/** Breaks a word that is wider than the box between its letters, with at least one letter on each line. */
function breakWord(ctx: CanvasRenderingContext2D, word: string, spec: TextSpec, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const part of graphemes(word)) {
    if (line && lineWidth(ctx, line + part, spec) > width) {
      out.push(line);
      line = part;
    } else {
      line += part;
    }
  }
  if (line) out.push(line);
  return out;
}

/** The lines of the typed text: the manual breaks, then the wrap at the box width of an area text (at spaces first). */
function wrapLines(ctx: CanvasRenderingContext2D, spec: TextSpec): string[] {
  const manual = splitLines(spec.text);
  const width = areaWidth(spec);
  if (width === null) return manual;
  const out: string[] = [];
  for (const paragraph of manual) {
    const words = paragraph.split(/(\s+)/);
    let line = '';
    let gap = '';
    for (let i = 0; i < words.length; i += 2) {
      const word = words[i];
      const space = words[i + 1] ?? '';
      if (!word) {
        gap += space;
        continue;
      }
      const candidate = line + gap + word;
      if (lineWidth(ctx, candidate, spec) <= width) {
        line = candidate;
      } else {
        if (line) out.push(line);
        line = '';
        if (lineWidth(ctx, word, spec) > width) {
          const pieces = breakWord(ctx, word, spec, width);
          out.push(...pieces.slice(0, -1));
          line = pieces[pieces.length - 1] ?? '';
        } else {
          line = word;
        }
      }
      gap = space;
    }
    out.push(line);
  }
  return out;
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
  const texts = wrapLines(ctx, spec).map((line) => transformText(line, spec.transform));
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
    const advanceWidth = text ? plain.width + extra : 0;
    widths.push(advanceWidth);
    inks.push({
      left: text ? plain.actualBoundingBoxLeft : 0,
      right: text ? plain.actualBoundingBoxRight + extra : 0,
      up: text ? plain.actualBoundingBoxAscent : 0,
      down: text ? plain.actualBoundingBoxDescent : 0,
    });
    width = Math.max(width, advanceWidth);
    lines.push({ text, width: advanceWidth, x: 0, baseline: 0, glyphs });
  }
  width = areaWidth(spec) ?? width;
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
    height,
    minX: Math.min(0, Number.isFinite(inkMinX) ? inkMinX : 0) - margins.left,
    maxX: Math.max(width, Number.isFinite(inkMaxX) ? inkMaxX : 0) + margins.right,
    minY: Math.min(0, Number.isFinite(inkMinY) ? inkMinY : 0) - margins.top,
    maxY: Math.max(height, Number.isFinite(inkMaxY) ? inkMaxY : 0) + margins.bottom,
  };
}

/** The image size and the placement of the text box in it: the ink and the effects, with no extra space. */
function frame(spec: TextSpec, layout: Layout): { width: number; height: number; placement: TextPlacement } {
  const anchorInBox = areaWidth(spec) !== null ? 0 : spec.align === 'center' ? layout.width / 2 : spec.align === 'right' ? layout.width : 0;
  // Whole pixels from the anchor to each edge, so the anchor sits on a pixel corner and a layer that keeps it never drifts.
  const left = Math.max(0, Math.ceil(anchorInBox - layout.minX));
  const right = Math.max(0, Math.ceil(layout.maxX - anchorInBox));
  const top = Math.max(0, Math.ceil(-layout.minY));
  const bottom = Math.max(0, Math.ceil(layout.maxY));
  const { maxSide, maxPixels } = PARAMS.limits;
  const width = Math.min(maxSide, Math.max(1, left + right));
  const height = Math.min(maxSide, Math.max(1, top + bottom), Math.max(1, Math.floor(maxPixels / width)));
  return { width, height, placement: { ax: left, ay: top, boxX: left - anchorInBox, boxW: layout.width, boxH: layout.height } };
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

function emptyPlacement(spec: TextSpec): TextPlacement {
  return { ax: 0, ay: 0, boxX: 0, boxW: areaWidth(spec) ?? 0, boxH: spec.size * spec.lineHeight };
}

/** A 1 x 1 transparent image; an area text keeps its box in the placement. */
function emptyImage(spec: TextSpec): RasterImage {
  const image = createRaster(1, 1);
  placements.set(image, emptyPlacement(spec));
  return image;
}

/** Renders now with `family`, which must be loaded. The image is generated, so its pixels can be read from the canvas. */
function draw(spec: TextSpec, family: string): RasterImage {
  if (!spec.text) return emptyImage(spec);
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
    return emptyImage(spec);
  }
}

/** Loads the font (or the bundled one when it fails), then renders. The status says which font the image uses. */
export async function renderTextWithStatus(spec: TextSpec): Promise<{ image: RasterImage; status: FontStatus }> {
  if (!spec.text) return { image: emptyImage(spec), status: 'ready' };
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
  if (!spec.text) return emptyImage(spec);
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
  const area = areaWidth(spec);
  out.boxWidth = area === null ? null : Math.max(1, round(area * f));
  return out;
}

/** The placement of a text image. An image that this module did not render (a copy) is measured again. */
export function placementOf(image: RasterImage, spec: TextSpec): TextPlacement {
  const known = placements.get(image);
  if (known) return known;
  if (!spec.text) return emptyPlacement(spec);
  try {
    const family = fontReady(spec.family, spec.weight, spec.italic) ? spec.family : BUNDLED_FAMILY;
    const placement = frame(spec, layoutText(measurer(), spec, family)).placement;
    placements.set(image, placement);
    return placement;
  } catch {
    return emptyPlacement(spec);
  }
}

/** The text box of a text layer in document px: the wrap box of an area text, the box of the lines of a free text. */
export function textBox(layer: TextLayer): Rect {
  const placement = placementOf(layer.image, layer.spec);
  return { x: layer.x + placement.boxX, y: layer.y + placement.ay, w: placement.boxW, h: placement.boxH };
}

/**
 * The anchor of a text layer in document px, for a spec with `align` that is an area text or not: the top of its
 * text box, and the left of the box for an area text, else its left, center or right by the alignment.
 */
export function textAnchor(layer: TextLayer, align: TextSpec['align'] = layer.spec.align, area = areaWidth(layer.spec) !== null): Point {
  const placement = placementOf(layer.image, layer.spec);
  const left = layer.x + placement.boxX;
  const x = area ? left : align === 'center' ? left + placement.boxW / 2 : align === 'right' ? left + placement.boxW : left;
  return { x: Math.round(x), y: layer.y + placement.ay };
}

/** The lines of the typed text after the wrap, so an area text can become a free text with the same line breaks. */
export function wrappedText(spec: TextSpec): string {
  if (areaWidth(spec) === null || !spec.text) return spec.text;
  try {
    const ctx = measurer();
    const family = fontReady(spec.family, spec.weight, spec.italic) ? spec.family : BUNDLED_FAMILY;
    ctx.font = fontOf(spec, family);
    if (hasLetterSpacing(ctx)) ctx.letterSpacing = '0px';
    return wrapLines(ctx, spec).join('\n');
  } catch {
    return spec.text;
  }
}

/** The top-left corner (document px) that puts the anchor of `image` at `anchor`. */
export function placeText(anchor: Point, image: RasterImage, spec: TextSpec): Point {
  const placement = placementOf(image, spec);
  return { x: Math.round(anchor.x - placement.ax), y: Math.round(anchor.y - placement.ay) };
}
