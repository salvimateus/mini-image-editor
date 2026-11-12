import type { Point, Rect } from '../core/types.ts';
import { TUNING } from '../app/tuning/index.ts';
import type { Camera } from './camera.ts';
import type { ParticleField } from './particles.ts';

/** What a scene and an overlay can use from the stage that shows them. */
export interface StageHost {
  readonly camera: Camera;
  readonly particles: ParticleField;
  readonly dpr: number;
  readonly reducedMotion: boolean;
  /** Asks for one more frame of the main canvas and the fx canvas. The loop stops when nothing is dirty or alive. */
  invalidate(): void;
  /** Asks for one more frame of the fx canvas only. */
  invalidateFx(): void;
}

/** The drawable content of the stage. */
export interface Scene {
  readonly contentW: number;
  readonly contentH: number;
  readonly maxZoom: number;
  /** The zoom of the first view, given a camera that already knows the viewport. */
  initialZoom(camera: Camera): number;
  attach(host: StageHost | null): void;
  /** Main canvas: checkerboard, layers, preview. Returns true to keep the loop alive. */
  draw(ctx: CanvasRenderingContext2D, now: number): boolean;
  /** Fx canvas: overlays and cursors. The stage draws the particles after it. Returns true to keep the loop alive. */
  drawFx(fx: CanvasRenderingContext2D, now: number): boolean;
}

/**
 * One pointer sample on the stage. sx, sy in stage CSS px; ix, iy in document px; samples = the coalesced document
 * points of this event, the last one equal to ix, iy.
 */
export interface StagePointer {
  sx: number;
  sy: number;
  ix: number;
  iy: number;
  shift: boolean;
  alt: boolean;
  /** Ctrl (Cmd on a Mac). */
  ctrl: boolean;
  /** PointerEvent.button of the press: 0 primary, 1 middle, 2 right. */
  button: number;
  samples: readonly Point[];
}

/** The stage as the rest of the app sees it (app.stage). */
export interface StageApi {
  readonly camera: Camera;
  readonly host: StageHost;
  readonly particles: ParticleField;
  /** Stage size in CSS px. */
  readonly viewport: { width: number; height: number };
  fitView(): void;
  /** Zooms by `factor` at (sx, sy) in stage CSS px, or at the stage center. */
  zoomBy(factor: number, sx?: number, sy?: number): void;
  /** Zooms to `scale` (1 = 100%) at (sx, sy) in stage CSS px, or at the stage center. */
  zoomTo(scale: number, sx?: number, sy?: number): void;
  invalidate(): void;
  invalidateFx(): void;
  docToScreen(x: number, y: number): Point;
  screenToDoc(sx: number, sy: number): Point;
}

/** Canvas colors, keyed to the --stage-* tokens of tokens.css. */
const STAGE_TOKENS = {
  bg: '--stage-bg',
  checkerA: '--stage-checker-a',
  checkerB: '--stage-checker-b',
  accent: '--stage-accent',
  accentFill: '--stage-accent-fill',
  teal: '--stage-teal',
  yellow: '--stage-yellow',
  pink: '--stage-pink',
  danger: '--stage-danger',
  white: '--stage-white',
  black: '--stage-black',
  shadow: '--stage-shadow',
  edge: '--stage-edge',
  guide: '--stage-guide',
  grid: '--stage-grid',
  gridStrong: '--stage-grid-strong',
  snap: '--stage-snap',
  antsA: '--stage-ants-a',
  antsB: '--stage-ants-b',
  handle: '--stage-handle',
  handleEdge: '--stage-handle-edge',
  shade: '--stage-shade',
  ring: '--stage-ring',
  ruler: '--stage-ruler',
  rulerLine: '--stage-ruler-line',
  rulerText: '--stage-ruler-text',
  panel: '--stage-panel',
  panelEdge: '--stage-panel-edge',
  flash: '--stage-flash',
} as const;

export type StageColor = keyof typeof STAGE_TOKENS;

/** Filled from the tokens by loadStageColors() before the first frame. */
export const STAGE_COLORS = Object.fromEntries(Object.keys(STAGE_TOKENS).map((key) => [key, 'transparent'])) as Record<StageColor, string>;

let colorsVersion = 0;
let loadedVersion = -1;

/** Changes each time the theme changes: a sprite or pattern drawn with STAGE_COLORS keeps it to know when to redraw. */
export function stageColorsVersion(): number {
  return colorsVersion;
}

/** Reads the --stage-* tokens of the current theme, so the canvas and the CSS share one palette. Cheap when nothing changed. */
export function loadStageColors(): void {
  if (loadedVersion === colorsVersion || typeof document === 'undefined') return;
  const style = getComputedStyle(document.documentElement);
  let found = 0;
  for (const [key, token] of Object.entries(STAGE_TOKENS) as Array<[StageColor, string]>) {
    const value = style.getPropertyValue(token).trim();
    if (!value) continue;
    STAGE_COLORS[key] = value;
    found++;
  }
  if (found > 0) loadedVersion = colorsVersion;
}

/** Marks the colors as old and reads them again from the new theme. The theme service calls it. */
export function refreshStageColors(): void {
  colorsVersion++;
  loadStageColors();
}

/** The colors of sparks and confetti: the accents of the theme. */
export function sparkColors(): string[] {
  return [STAGE_COLORS.accent, STAGE_COLORS.teal, STAGE_COLORS.yellow, STAGE_COLORS.pink, STAGE_COLORS.white];
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** 0..1 of an animation that started at `start` (a negative start means done). */
export function progress(now: number, start: number, duration: number): number {
  if (start < 0 || duration <= 0) return 1;
  return Math.min(1, Math.max(0, (now - start) / duration));
}

/** The center of the physical pixel nearest to `value` (CSS px), so a 1 px line stays sharp. */
export function snap(value: number, dpr: number): number {
  return (Math.round(value * dpr) + 0.5) / dpr;
}

/** The nearest physical pixel edge to `value` (CSS px), for fills. */
export function snapEdge(value: number, dpr: number): number {
  return Math.round(value * dpr) / dpr;
}

/** The stage (document rect 0, 0, width, height) in screen CSS px. */
export function contentRect(camera: Camera): Rect {
  return { x: camera.panX, y: camera.panY, w: camera.contentW * camera.zoom, h: camera.contentH * camera.zoom };
}

const checkerCache = new WeakMap<CanvasRenderingContext2D, { pattern: CanvasPattern; version: number }>();

/** A checkerboard of TUNING.stage.checkerPx CSS pixel squares, for transparent areas. */
export function checkerPattern(ctx: CanvasRenderingContext2D): CanvasPattern | string {
  const cached = checkerCache.get(ctx);
  if (cached && cached.version === colorsVersion) return cached.pattern;
  const side = TUNING.stage.checkerPx;
  const tile = document.createElement('canvas');
  tile.width = tile.height = side * 2;
  const tileCtx = tile.getContext('2d');
  if (!tileCtx) return STAGE_COLORS.checkerA;
  tileCtx.fillStyle = STAGE_COLORS.checkerA;
  tileCtx.fillRect(0, 0, side * 2, side * 2);
  tileCtx.fillStyle = STAGE_COLORS.checkerB;
  tileCtx.fillRect(0, 0, side, side);
  tileCtx.fillRect(side, side, side, side);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return STAGE_COLORS.checkerA;
  checkerCache.set(ctx, { pattern, version: colorsVersion });
  return pattern;
}

/** The hard drop shadow under the stage. Draw it before the checkerboard. */
export function drawFrameShadow(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const offset = TUNING.stage.frameShadowPx;
  ctx.fillStyle = STAGE_COLORS.shadow;
  ctx.fillRect(rect.x + offset, rect.y + offset, rect.w, rect.h);
}

/** A thin outline just outside the stage. Draw it after the layers. */
export function drawFrameEdge(ctx: CanvasRenderingContext2D, rect: Rect, dpr: number): void {
  const x = snapEdge(rect.x, dpr);
  const y = snapEdge(rect.y, dpr);
  const right = snapEdge(rect.x + rect.w, dpr);
  const bottom = snapEdge(rect.y + rect.h, dpr);
  const half = 0.5 / dpr;
  ctx.strokeStyle = STAGE_COLORS.edge;
  ctx.lineWidth = 1 / dpr;
  ctx.strokeRect(x - half, y - half, right - x + half * 2, bottom - y + half * 2);
}
