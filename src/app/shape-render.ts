import { toCss } from '../core/color.ts';
import { PARAMS } from '../core/params/index.ts';
import { createRaster } from '../core/raster.ts';
import type { Point, RasterImage, Rect, ShapeSpec } from '../core/types.ts';
import { cloneShapeSpec, type ShapeLayer } from './layers.ts';
import { TUNING } from './tuning/index.ts';

type ArrowSpec = Extract<ShapeSpec, { kind: 'arrow' }>;

/** The family of the UI font; a step number uses it in bold. */
const STEP_FAMILY = 'Nunito Variable';
const STEP_FALLBACK = `'Nunito', system-ui, sans-serif`;

/** The shape outline in geometry coordinates (spec origin at 0, 0), its bounds, and the room its effects need outside them. */
interface Outline {
  trace(ctx: CanvasRenderingContext2D, ox: number, oy: number): void;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** A drop shadow outside the bounds, on each side; zero when the shape has none. */
  extra?: { left: number; top: number; right: number; bottom: number };
}

type StepSpec = Extract<ShapeSpec, { kind: 'step' }>;

/** The drop shadow of a step, or null when it is off (no value = on). */
function stepShadow(spec: StepSpec): { offset: number; blur: number } | null {
  if (spec.shadow === false) return null;
  const k = TUNING.shapes.stepShadow;
  const size = clampSide(spec.size);
  return { offset: Math.max(k.minOffsetPx, size * k.offset), blur: Math.max(k.minBlurPx, size * k.blur) };
}

let canvas: HTMLCanvasElement | null = null;
let ctx2d: CanvasRenderingContext2D | null = null;

/** One reused canvas: a shape renders once for each frame of a drag. */
function context(width: number, height: number): CanvasRenderingContext2D {
  if (!canvas || !ctx2d) {
    canvas = document.createElement('canvas');
    ctx2d = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx2d) throw new Error('No 2D canvas context.');
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  } else {
    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    ctx2d.clearRect(0, 0, width, height);
  }
  return ctx2d;
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clampSide(value: number): number {
  return Math.min(PARAMS.limits.maxSide / 2, Math.max(0, finite(value)));
}

// ----- arrow geometry -----

/** Length and width of the head; a short arrow gets a smaller head. */
function arrowHead(spec: ArrowSpec, length: number): { length: number; width: number } {
  const size = Math.max(0.5, spec.size);
  let headLength: number;
  let headWidth: number;
  if (spec.style === 'thin') {
    const head = TUNING.shapes.thinHead;
    headLength = head.length.base + head.length.perSize * size;
    headWidth = head.width.base + head.width.perSize * size;
  } else {
    headLength = TUNING.shapes.thickHead.length * size;
    headWidth = TUNING.shapes.thickHead.width * size;
  }
  const most = length * TUNING.shapes.headMaxShare;
  if (headLength > most && headLength > 0) {
    const k = most / headLength;
    headLength = most;
    headWidth = Math.max(size * 1.2, headWidth * k);
  }
  return { length: headLength, width: Math.max(headWidth, size) };
}

/** One polygon: a body of `size` px (a round tail for a thin arrow, a flat tail for a thick one) and the head. */
function arrowOutline(spec: ArrowSpec): Outline {
  const dx = finite(spec.dx);
  const dy = finite(spec.dy);
  const length = Math.hypot(dx, dy);
  const half = Math.max(0.25, spec.size / 2);
  const round = spec.style === 'thin';
  if (length < 1e-6) {
    const r = half;
    return {
      trace(ctx, ox, oy) {
        ctx.moveTo(ox + r, oy);
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
      },
      bounds: { minX: -r, minY: -r, maxX: r, maxY: r },
    };
  }
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const head = arrowHead(spec, length);
  const base = length - head.length;
  const hw = head.width / 2;
  const at = (along: number, side: number): Point => ({ x: ux * along + nx * side, y: uy * along + ny * side });
  const points = [at(base, half), at(base, hw), at(length, 0), at(base, -hw), at(base, -half), at(0, -half)];
  if (!round) points.push(at(0, half));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (round) {
    minX = Math.min(minX, -half);
    minY = Math.min(minY, -half);
    maxX = Math.max(maxX, half);
    maxY = Math.max(maxY, half);
  }
  const angle = Math.atan2(ny, nx);
  return {
    trace(ctx, ox, oy) {
      ctx.moveTo(ox + points[0].x, oy + points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(ox + points[i].x, oy + points[i].y);
      // The tail cap: a half circle from the -normal side back to the +normal side, around the back of the tail.
      if (round) ctx.arc(ox, oy, half, angle + Math.PI, angle, true);
      ctx.closePath();
    },
    bounds: { minX, minY, maxX, maxY },
  };
}

// ----- outlines -----

function outlineOf(spec: ShapeSpec): Outline {
  switch (spec.kind) {
    case 'rect': {
      const w = clampSide(spec.w);
      const h = clampSide(spec.h);
      const radius = Math.min(Math.max(0, finite(spec.radius)), Math.min(w, h) / 2);
      return {
        trace(ctx, ox, oy) {
          if (radius > 0) ctx.roundRect(ox, oy, w, h, radius);
          else ctx.rect(ox, oy, w, h);
        },
        bounds: { minX: 0, minY: 0, maxX: w, maxY: h },
      };
    }
    case 'ellipse': {
      const w = clampSide(spec.w);
      const h = clampSide(spec.h);
      return {
        trace(ctx, ox, oy) {
          ctx.ellipse(ox + w / 2, oy + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        },
        bounds: { minX: 0, minY: 0, maxX: w, maxY: h },
      };
    }
    case 'arrow':
      return arrowOutline(spec);
    case 'step': {
      const r = clampSide(spec.size) / 2;
      const shadow = stepShadow(spec);
      // A canvas shadow blur has a sigma of half the blur value; three sigmas hold the visible part.
      const reach = shadow ? Math.ceil(shadow.blur * 1.5) : 0;
      return {
        extra: shadow ? { left: reach, right: reach, top: Math.max(0, reach - shadow.offset), bottom: reach + Math.ceil(shadow.offset) } : undefined,
        trace(ctx, ox, oy) {
          ctx.moveTo(ox + r, oy);
          ctx.arc(ox, oy, r, 0, Math.PI * 2);
        },
        bounds: { minX: -r, minY: -r, maxX: r, maxY: r },
      };
    }
  }
}

/** The image size and the spec origin in it, in whole px, so a layer that keeps its origin never drifts. */
function frame(outline: Outline): { width: number; height: number; origin: Point } {
  const pad = TUNING.shapes.padPx;
  const { minX, minY, maxX, maxY } = outline.bounds;
  const e = outline.extra ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const ox = pad + Math.max(0, Math.ceil(e.left - minX - 1e-6));
  const oy = pad + Math.max(0, Math.ceil(e.top - minY - 1e-6));
  const maxSide = PARAMS.limits.maxSide;
  const width = Math.min(maxSide, Math.max(1, ox + Math.ceil(maxX + e.right - 1e-6) + pad));
  const height = Math.min(maxSide, Math.max(1, oy + Math.ceil(maxY + e.bottom - 1e-6) + pad));
  return { width, height, origin: { x: ox, y: oy } };
}

/** Where the spec origin sits inside the rendered image: rect and ellipse top-left, arrow tail, step center. */
export function shapeOrigin(spec: ShapeSpec): Point {
  return frame(outlineOf(spec)).origin;
}

/** The shape geometry in layer px, without the padding. */
function geometryRect(spec: ShapeSpec): Rect {
  const outline = outlineOf(spec);
  const { origin } = frame(outline);
  const b = outline.bounds;
  return { x: origin.x + b.minX, y: origin.y + b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

/** The shape geometry in document px, without the border padding. */
export function shapeBox(layer: ShapeLayer): Rect {
  const r = geometryRect(layer.spec);
  return { x: layer.x + r.x, y: layer.y + r.y, w: r.w, h: r.h };
}

// ----- step font -----

let fontPromise: Promise<void> | null = null;
let fontLoaded = false;

function stepFont(size: number): string {
  return `${TUNING.shapes.stepFont.weight} ${size}px '${STEP_FAMILY}', ${STEP_FALLBACK}`;
}

/** Loads the bold UI font of the step numbers. Never rejects; it resolves after a time limit at most. */
export function loadShapeFont(): Promise<void> {
  if (fontLoaded) return Promise.resolve();
  if (fontPromise) return fontPromise;
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts) {
    fontLoaded = true;
    return Promise.resolve();
  }
  const load = fonts.load(stepFont(64), '0123456789').then(
    () => {
      fontLoaded = true;
    },
    () => undefined,
  );
  const limit = new Promise<void>((resolve) => setTimeout(resolve, TUNING.shapes.fontTimeoutMs));
  fontPromise = Promise.race([load, limit]).finally(() => {
    fontPromise = null;
  });
  return fontPromise;
}

/** True when the step number font is ready, so a step render now uses it. */
export function shapeFontReady(): boolean {
  return fontLoaded;
}

function drawNumber(ctx: CanvasRenderingContext2D, spec: StepSpec, cx: number, cy: number): void {
  const text = String(Math.max(0, Math.round(finite(spec.number))));
  const diameter = clampSide(spec.size);
  const inner = Math.max(1, diameter - 2 * Math.max(0, spec.stroke.width));
  const { scale, fit } = TUNING.shapes.stepFont;
  let size = diameter * scale[Math.min(scale.length - 1, text.length - 1)];
  ctx.font = stepFont(size);
  const width = ctx.measureText(text).width;
  if (width > inner * fit) {
    size *= (inner * fit) / width;
    ctx.font = stepFont(size);
  }
  const metrics = ctx.measureText(text);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Center the ink, not the font box: digits have no descender.
  const up = metrics.actualBoundingBoxAscent;
  const down = metrics.actualBoundingBoxDescent;
  const left = metrics.actualBoundingBoxLeft;
  const right = metrics.actualBoundingBoxRight;
  const x = cx + (left - right) / 2;
  ctx.fillStyle = toCss(spec.textColor);
  ctx.fillText(text, x, cy + (up - down) / 2);
}

// ----- render -----

/**
 * Renders the shape: the fill, then the border inside the outline (a stroke of twice the width, clipped to the shape),
 * so the border never grows the box. Anti-aliased, with a transparent pad on each side. The image is generated, so
 * its pixels can be read from the canvas.
 */
export function renderShapeLayer(spec: ShapeSpec): RasterImage {
  try {
    const outline = outlineOf(spec);
    const { width, height, origin } = frame(outline);
    const ctx = context(width, height);
    const fill = spec.fill;
    const path = () => {
      ctx.beginPath();
      outline.trace(ctx, origin.x, origin.y);
    };
    const shadow = spec.kind === 'step' && fill && fill.a > 0 ? stepShadow(spec) : null;
    if (shadow && fill) {
      // The disc casts the shadow; the border and the number then draw on top with no shadow.
      ctx.save();
      ctx.shadowColor = TUNING.shapes.stepShadow.color;
      ctx.shadowBlur = shadow.blur;
      ctx.shadowOffsetY = shadow.offset;
      path();
      ctx.fillStyle = toCss(fill);
      ctx.fill();
      ctx.restore();
    } else if (fill && fill.a > 0) {
      path();
      ctx.fillStyle = toCss(fill);
      ctx.fill();
    }
    const strokeWidth = Math.max(0, finite(spec.stroke.width));
    if (strokeWidth > 0 && spec.stroke.color.a > 0) {
      path();
      ctx.save();
      ctx.clip();
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 10;
      ctx.lineWidth = strokeWidth * 2;
      ctx.strokeStyle = toCss(spec.stroke.color);
      ctx.stroke();
      ctx.restore();
    }
    if (spec.kind === 'step') drawNumber(ctx, spec, origin.x, origin.y);
    const pixels = ctx.getImageData(0, 0, width, height);
    return { width, height, data: pixels.data };
  } catch {
    return createRaster(1, 1);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Sizes and positions scale; the border width, the radius, the arrow size and the step size scale by sqrt(sx * sy). */
export function scaleShapeSpec(spec: ShapeSpec, sx: number, sy: number): ShapeSpec {
  const kx = Number.isFinite(sx) && sx > 0 ? sx : 1;
  const ky = Number.isFinite(sy) && sy > 0 ? sy : 1;
  const k = Math.sqrt(kx * ky);
  const out = cloneShapeSpec(spec);
  out.stroke.width = round2(spec.stroke.width * k);
  switch (out.kind) {
    case 'rect':
      out.w = Math.max(1, round2(out.w * kx));
      out.h = Math.max(1, round2(out.h * ky));
      out.radius = round2(out.radius * k);
      break;
    case 'ellipse':
      out.w = Math.max(1, round2(out.w * kx));
      out.h = Math.max(1, round2(out.h * ky));
      break;
    case 'arrow':
      out.dx = round2(out.dx * kx);
      out.dy = round2(out.dy * ky);
      out.size = Math.max(0.5, round2(out.size * k));
      break;
    case 'step':
      out.size = Math.max(1, round2(out.size * k));
      break;
  }
  return out;
}

if (typeof document !== 'undefined') void loadShapeFont();
