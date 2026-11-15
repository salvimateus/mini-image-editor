import { CoreError } from '../core/errors.ts';
import { PARAMS } from '../core/params/index.ts';
import type { RasterImage, SvgSpec } from '../core/types.ts';
import { stageSizeProblem } from './actions/geometry.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const SVG_TAG = /<svg[\s/>]/i;
const FIRST_SVG_TAG = /<svg(?=[\s/>])/i;
const LENGTH = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/i;
/** CSS px for each absolute unit; the relative units (%, em) give no size. */
const UNIT_PX: Record<string, number> = { '': 1, px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

/** 'broken' = the XML does not parse; 'other' = it parses, but its root is not an SVG element. */
type RootResult = Element | 'broken' | 'other';

function parseRoot(text: string): RootResult {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.getElementsByTagNameNS('*', 'parsererror').length > 0) return 'broken';
  const root = doc.documentElement;
  return root && root.localName === 'svg' ? root : 'other';
}

/**
 * The root in the SVG namespace. Markup copied from an HTML page often has no xmlns (or no xmlns:xlink for its
 * xlink:href), so the missing declarations are added to the svg tag.
 */
function readRoot(text: string): RootResult {
  const first = parseRoot(text);
  if (typeof first !== 'string' && first.namespaceURI === SVG_NS) return first;
  const tag = /<svg[\s/>][^>]*>?/i.exec(text)?.[0] ?? '';
  const missing = [
    /\sxmlns\s*=/.test(tag) ? '' : ` xmlns="${SVG_NS}"`,
    /xlink:/.test(text) && !/\sxmlns:xlink\s*=/.test(tag) ? ` xmlns:xlink="${XLINK_NS}"` : '',
  ].join('');
  const failure = typeof first === 'string' ? first : 'other';
  if (!tag || !missing) return failure;
  const fixed = parseRoot(text.replace(FIRST_SVG_TAG, `<svg${missing}`));
  if (typeof fixed === 'string') return failure;
  return fixed.namespaceURI === SVG_NS ? fixed : 'other';
}

function rootOrThrow(text: string): Element {
  const root = readRoot(text);
  if (root === 'broken') throw new CoreError('decode-failed', 'The SVG markup does not parse.');
  if (root === 'other') throw new CoreError('not-an-image', 'The root element is not an SVG element.');
  return root;
}

/** A length attribute in px, or null for a missing, relative or non-positive value. */
function lengthPx(value: string | null): number | null {
  if (!value) return null;
  const match = LENGTH.exec(value);
  if (!match) return null;
  const px = Number(match[1]) * UNIT_PX[(match[2] ?? '').toLowerCase()];
  return Number.isFinite(px) && px > 0 ? px : null;
}

function viewBoxSize(value: string | null): { w: number; h: number } | null {
  if (!value) return null;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part)) || parts[2] <= 0 || parts[3] <= 0) return null;
  return { w: parts[2], h: parts[3] };
}

const CSS_URL = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;

/** True for a reference that an <img> never loads: anything but a data: URL or a #fragment of the same file. */
function isExternalTarget(target: string): boolean {
  const value = target.trim();
  return value !== '' && !value.startsWith('#') && !/^data:/i.test(value);
}

function cssHasExternal(css: string): boolean {
  if (/@import\b/i.test(css)) return true;
  for (const match of css.matchAll(CSS_URL)) if (isExternalTarget(match[2])) return true;
  return false;
}

/**
 * True when the parsed SVG refers to fonts or images outside the file: an href (or xlink:href) to a URL, a CSS url()
 * to a URL in an attribute or a <style>, or an @import. An <img> loads none of them. The href of a link (<a>) is not a load.
 */
function hasExternalRefs(root: Element): boolean {
  for (const element of [root, ...Array.from(root.getElementsByTagName('*'))]) {
    if (element.localName === 'style' && cssHasExternal(element.textContent ?? '')) return true;
    for (const attr of Array.from(element.attributes)) {
      if (attr.localName === 'href' && element.localName !== 'a' && isExternalTarget(attr.value)) return true;
      if (/url\(/i.test(attr.value) && cssHasExternal(attr.value)) return true;
    }
  }
  return false;
}

/** True when the text is SVG markup: it parses with no error and its root is an svg element. */
export function isSvgMarkup(text: string): boolean {
  return SVG_TAG.test(text) && typeof readRoot(text) !== 'string';
}

/** A file that holds SVG: its type, or the .svg extension when the type is empty. */
export function isSvgFile(file: File): boolean {
  return file.type === 'image/svg+xml' || (file.type === '' && /\.svg$/i.test(file.name));
}

/**
 * The spec of the markup at its natural size, and whether it refers to fonts or images outside the file. The size comes from the root width and height (absolute units), else
 * from the viewBox, else PARAMS.svg.defaultSide. A root with no viewBox gets one, so the content scales with the render.
 */
export function parseSvg(text: string): { spec: SvgSpec; external: boolean } {
  const root = rootOrThrow(text);
  const external = hasExternalRefs(root);
  const box = viewBoxSize(root.getAttribute('viewBox'));
  let w = lengthPx(root.getAttribute('width'));
  let h = lengthPx(root.getAttribute('height'));
  if (w === null && h === null) {
    if (box) {
      w = box.w;
      h = box.h;
    }
  } else if (w === null && h !== null) {
    w = box ? (h * box.w) / box.h : h;
  } else if (h === null && w !== null) {
    h = box ? (w * box.h) / box.w : w;
  }
  if (w === null || h === null) {
    w = PARAMS.svg.defaultSide;
    h = PARAMS.svg.defaultSide;
  }
  if (!box) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const source = new XMLSerializer().serializeToString(root);
  return { spec: { source, naturalWidth: w, naturalHeight: h, width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }, external };
}

/** Reads the file as text before any other use of its bytes, then parses it. `external`: see hasExternalRefs. */
export async function readSvgFile(file: File): Promise<{ spec: SvgSpec; external: boolean }> {
  return parseSvg(await file.text());
}

/** The spec at a new render size: each side times its factor, in whole px. */
export function scaleSvgSpec(spec: SvgSpec, sx: number, sy: number): SvgSpec {
  return { ...spec, width: Math.max(1, Math.round(spec.width * sx)), height: Math.max(1, Math.round(spec.height * sy)) };
}

/** The spec with its long side at least `side` px, with its natural aspect; a larger spec stays at its natural size. */
export function growSvgSpec(spec: SvgSpec, side: number): SvgSpec {
  const long = Math.max(spec.naturalWidth, spec.naturalHeight);
  if (long >= side) return spec;
  const scale = side / long;
  return { ...spec, width: Math.max(1, Math.round(spec.naturalWidth * scale)), height: Math.max(1, Math.round(spec.naturalHeight * scale)) };
}

/** The spec at the largest size with its natural aspect that fits inside w x h, up or down. */
export function fitSvgSpec(spec: SvgSpec, w: number, h: number): SvgSpec {
  const scale = Math.min(w / spec.naturalWidth, h / spec.naturalHeight);
  return {
    ...spec,
    width: Math.min(w, Math.max(1, Math.round(spec.naturalWidth * scale))),
    height: Math.min(h, Math.max(1, Math.round(spec.naturalHeight * scale))),
  };
}

/**
 * Renders the vector at the spec size on a transparent background. The markup only loads through an <img> from a
 * blob: URL, where scripts and external resources never run, and never goes into the live DOM.
 */
export async function renderSvgLayer(spec: SvgSpec): Promise<RasterImage> {
  const width = Math.round(spec.width);
  const height = Math.round(spec.height);
  const problem = stageSizeProblem(width, height);
  if (problem) throw new CoreError('too-large', problem);
  const root = rootOrThrow(spec.source);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  const markup = new XMLSerializer().serializeToString(root);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  const canvas = document.createElement('canvas');
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new CoreError('decode-failed', 'The SVG could not be drawn.');
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new CoreError('too-large', 'No 2D canvas context at this size.');
    ctx.drawImage(image, 0, 0, width, height);
    try {
      return { width, height, data: ctx.getImageData(0, 0, width, height).data };
    } catch {
      throw new CoreError('decode-failed', 'The pixels of the SVG could not be read.');
    }
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = 0;
    canvas.height = 0;
  }
}
