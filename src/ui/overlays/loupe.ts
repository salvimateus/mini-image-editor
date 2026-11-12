import { t } from '../../app/i18n/index.ts';
import { app } from '../../app/state.svelte.ts';
import { TUNING } from '../../app/tuning/index.ts';
import { toCss, toHex } from '../../core/color.ts';
import { sampleComposite, type FlatLayer } from '../../core/composite.ts';
import type { Point, Rgba } from '../../core/types.ts';
import { STAGE_COLORS, checkerPattern, type StageHost } from '../stage-renderer.ts';
import type { SceneOverlay } from './types.ts';

const LABEL_FONT = "800 12px 'Nunito Variable', 'Nunito', system-ui, sans-serif";
const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/** The point under the loupe in document px, or null when the loupe is hidden. */
let target: Point | null = null;

/** The enlarged pixels: rebuilt only when the pixel under the pointer or the document changes. */
let grid: { doc: object; key: string; canvas: HTMLCanvasElement; center: Rgba } | null = null;

/** Shows the loupe at a document point, or hides it with null. */
export function showLoupe(point: Point | null): void {
  if (!point && !target) return;
  target = point ? { x: point.x, y: point.y } : null;
  app.stage?.invalidateFx();
}

function flatLayers(): FlatLayer[] {
  const doc = app.doc;
  if (!doc) return [];
  return doc.layers.filter((layer) => layer.visible && layer.opacity > 0).map((layer) => ({ image: layer.image, x: layer.x, y: layer.y, opacity: layer.opacity }));
}

function buildGrid(ix: number, iy: number): { canvas: HTMLCanvasElement; center: Rgba } | null {
  const doc = app.doc;
  if (!doc) return null;
  const cells = TUNING.paint.loupe.cells;
  const half = Math.floor(cells / 2);
  const canvas = grid?.canvas ?? document.createElement('canvas');
  canvas.width = canvas.height = cells;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(cells, cells);
  const layers = flatLayers();
  let center = TRANSPARENT;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const px = ix - half + x;
      const py = iy - half + y;
      const inside = px >= 0 && py >= 0 && px < doc.width && py < doc.height;
      const color = inside ? sampleComposite(layers, px, py) : TRANSPARENT;
      if (x === half && y === half) center = color;
      const o = (y * cells + x) * 4;
      image.data[o] = color.r;
      image.data[o + 1] = color.g;
      image.data[o + 2] = color.b;
      image.data[o + 3] = color.a;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, center };
}

function halfRing(fx: CanvasRenderingContext2D, x: number, y: number, radius: number, width: number, from: number, color: string): void {
  fx.beginPath();
  fx.arc(x, y, radius + width / 2, from, from + Math.PI);
  fx.lineWidth = width;
  fx.strokeStyle = color;
  fx.stroke();
}

function draw(fx: CanvasRenderingContext2D, host: StageHost, _now: number): boolean {
  const doc = app.doc;
  if (!target || !doc) return false;
  const { radiusPx, cells, ringPx, labelGapPx } = TUNING.paint.loupe;
  const ix = Math.floor(target.x);
  const iy = Math.floor(target.y);
  const key = `${ix},${iy},${doc.version},${doc.layers.length}`;
  if (!grid || grid.doc !== doc || grid.key !== key) {
    const built = buildGrid(ix, iy);
    if (!built) return false;
    grid = { doc, key, ...built };
  }
  const at = host.camera.imageToScreen(target.x, target.y);
  const cell = (radiusPx * 2) / cells;
  // The picked pixel sits in the center cell, with the ring centered on that cell.
  const cx = at.x;
  const cy = at.y;
  const left = cx - radiusPx;
  const top = cy - radiusPx;

  fx.save();
  fx.beginPath();
  fx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  fx.clip();
  fx.fillStyle = checkerPattern(fx);
  fx.fillRect(left, top, radiusPx * 2, radiusPx * 2);
  fx.imageSmoothingEnabled = false;
  fx.drawImage(grid.canvas, left, top, radiusPx * 2, radiusPx * 2);
  fx.restore();

  const centerColor = grid.center;
  const picked = centerColor.a > 0 ? toCss({ ...centerColor, a: 255 }) : STAGE_COLORS.checkerA;
  halfRing(fx, cx, cy, radiusPx, ringPx, Math.PI, picked);
  halfRing(fx, cx, cy, radiusPx, ringPx, 0, toCss(app.fg));
  fx.beginPath();
  fx.arc(cx, cy, radiusPx + ringPx, 0, Math.PI * 2);
  fx.lineWidth = 1.5;
  fx.strokeStyle = STAGE_COLORS.black;
  fx.stroke();
  fx.beginPath();
  fx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  fx.lineWidth = 1;
  fx.strokeStyle = STAGE_COLORS.white;
  fx.stroke();

  const half = cell / 2;
  fx.lineWidth = 1;
  fx.strokeStyle = STAGE_COLORS.black;
  fx.strokeRect(cx - half - 1, cy - half - 1, cell + 2, cell + 2);
  fx.strokeStyle = STAGE_COLORS.white;
  fx.strokeRect(cx - half, cy - half, cell, cell);

  const text = centerColor.a > 0 ? toHex(centerColor).toUpperCase() : t('paint.loupe.transparent');
  fx.font = LABEL_FONT;
  const width = fx.measureText(text).width + 18;
  const height = 22;
  const ly = cy + radiusPx + ringPx + labelGapPx + height / 2;
  fx.fillStyle = STAGE_COLORS.panel;
  fx.strokeStyle = STAGE_COLORS.panelEdge;
  fx.beginPath();
  fx.roundRect(cx - width / 2, ly - height / 2, width, height, height / 2);
  fx.fill();
  fx.stroke();
  fx.fillStyle = STAGE_COLORS.white;
  fx.textAlign = 'center';
  fx.textBaseline = 'middle';
  fx.fillText(text, cx, ly + 1);
  return false;
}

/** A ring of enlarged pixels around the pointer with the hex value: the eyedropper and the Alt pick of the paint tools. */
export const loupeOverlay: SceneOverlay = {
  z: 100,
  drawFx: draw,
};
