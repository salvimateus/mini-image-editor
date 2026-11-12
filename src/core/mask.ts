import { PARAMS } from './params/index.ts';
import type { Rect } from './types.ts';

/** Coverage 0..255 per document pixel, row-major. `bounds` holds every pixel with coverage > 0, or null when empty. */
export interface Mask { readonly width: number; readonly height: number; readonly data: Uint8Array; readonly bounds: Rect | null }

export type MaskOp = 'replace' | 'add' | 'subtract' | 'intersect';

/** Coverage of the 1-px cell [p, p + 1) inside the span [a, b). */
function spanCover(p: number, a: number, b: number): number {
  const lo = Math.max(p, a);
  const hi = Math.min(p + 1, b);
  return hi > lo ? hi - lo : 0;
}

function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function sanitizeSize(w: number, h: number): [number, number] {
  return [Math.max(0, Math.floor(w)), Math.max(0, Math.floor(h))];
}

export function rectMask(w: number, h: number, r: Rect, feather = 0): Mask {
  const [width, height] = sanitizeSize(w, h);
  const data = new Uint8Array(width * height);
  const x0 = Math.min(r.x, r.x + r.w);
  const x1 = Math.max(r.x, r.x + r.w);
  const y0 = Math.min(r.y, r.y + r.h);
  const y1 = Math.max(r.y, r.y + r.h);
  const px0 = clampInt(Math.floor(x0), 0, width);
  const px1 = clampInt(Math.ceil(x1), 0, width);
  const py0 = clampInt(Math.floor(y0), 0, height);
  const py1 = clampInt(Math.ceil(y1), 0, height);
  if (px1 > px0 && py1 > py0) {
    const colCover = new Float32Array(px1 - px0);
    for (let x = px0; x < px1; x++) colCover[x - px0] = spanCover(x, x0, x1);
    for (let y = py0; y < py1; y++) {
      const rowCover = spanCover(y, y0, y1) * 255;
      const base = y * width;
      for (let x = px0; x < px1; x++) data[base + x] = Math.round(rowCover * colCover[x - px0]);
    }
  }
  return finish(width, height, data, feather);
}

export function ellipseMask(w: number, h: number, r: Rect, feather = 0): Mask {
  const [width, height] = sanitizeSize(w, h);
  const data = new Uint8Array(width * height);
  const rx = Math.abs(r.w) / 2;
  const ry = Math.abs(r.h) / 2;
  const cx = Math.min(r.x, r.x + r.w) + rx;
  const cy = Math.min(r.y, r.y + r.h) + ry;
  if (rx > 0 && ry > 0) {
    const px0 = clampInt(Math.floor(cx - rx) - 1, 0, width);
    const px1 = clampInt(Math.ceil(cx + rx) + 1, 0, width);
    const py0 = clampInt(Math.floor(cy - ry) - 1, 0, height);
    const py1 = clampInt(Math.ceil(cy + ry) + 1, 0, height);
    const irx2 = 1 / (rx * rx);
    const iry2 = 1 / (ry * ry);
    for (let y = py0; y < py1; y++) {
      const dy = y + 0.5 - cy;
      const base = y * width;
      for (let x = px0; x < px1; x++) {
        const dx = x + 0.5 - cx;
        const f = dx * dx * irx2 + dy * dy * iry2 - 1;
        const gx = 2 * dx * irx2;
        const gy = 2 * dy * iry2;
        const grad = Math.sqrt(gx * gx + gy * gy);
        // Signed distance to the edge, in px (first-order estimate); a tiny ellipse falls back to the inside test.
        const dist = grad > 1e-9 ? f / grad : f < 0 ? -1 : 1;
        const cover = clampInt(0.5 - dist, 0, 1);
        if (cover > 0) data[base + x] = Math.round(cover * 255);
      }
    }
  }
  return finish(width, height, data, feather);
}

/** points = x0, y0, x1, y1, ... in document px; the polygon closes itself. Even-odd fill. */
export function polygonMask(w: number, h: number, points: Float32Array, feather = 0): Mask {
  const [width, height] = sanitizeSize(w, h);
  const data = new Uint8Array(width * height);
  const count = Math.floor(points.length / 2);
  if (count >= 3 && width > 0 && height > 0) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const y = points[i * 2 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const sub = PARAMS.mask.polygonSubsamples;
    const weight = 1 / sub;
    const row = new Float32Array(width + 1);
    const crossings: number[] = [];
    const py0 = clampInt(Math.floor(minY), 0, height);
    const py1 = clampInt(Math.ceil(maxY), 0, height);
    for (let y = py0; y < py1; y++) {
      row.fill(0);
      let touched = false;
      for (let s = 0; s < sub; s++) {
        const sy = y + (s + 0.5) * weight;
        crossings.length = 0;
        for (let i = 0, j = count - 1; i < count; j = i++) {
          const ax = points[j * 2];
          const ay = points[j * 2 + 1];
          const bx = points[i * 2];
          const by = points[i * 2 + 1];
          if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) crossings.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
        }
        if (crossings.length < 2) continue;
        crossings.sort((a, b) => a - b);
        for (let k = 0; k + 1 < crossings.length; k += 2) {
          const a = Math.max(0, crossings[k]);
          const b = Math.min(width, crossings[k + 1]);
          if (b <= a) continue;
          touched = true;
          const ia = Math.floor(a);
          const ib = Math.floor(b);
          if (ia === ib) {
            row[ia] += (b - a) * weight;
            continue;
          }
          row[ia] += (ia + 1 - a) * weight;
          for (let x = ia + 1; x < ib; x++) row[x] += weight;
          if (ib < width) row[ib] += (b - ib) * weight;
        }
      }
      if (!touched) continue;
      const base = y * width;
      for (let x = 0; x < width; x++) {
        const v = row[x];
        if (v > 0) data[base + x] = Math.round(Math.min(1, v) * 255);
      }
    }
  }
  return finish(width, height, data, feather);
}

function finish(width: number, height: number, data: Uint8Array, feather: number): Mask {
  const mask = maskFromData(width, height, data);
  return feather > 0 ? featherMask(mask, feather) : mask;
}

function computeBounds(width: number, height: number, data: Uint8Array): Rect | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const base = y * width;
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x++) {
      if (data[base + x] !== 0) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first < 0) continue;
    if (first < minX) minX = first;
    if (last > maxX) maxX = last;
    if (y < minY) minY = y;
    maxY = y;
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Wraps the data (no copy) and computes the bounds. */
export function maskFromData(w: number, h: number, data: Uint8Array): Mask {
  const [width, height] = sanitizeSize(w, h);
  if (data.length !== width * height) throw new RangeError(`A ${width} x ${height} mask needs ${width * height} bytes, got ${data.length}.`);
  return { width, height, data, bounds: computeBounds(width, height, data) };
}

/** A separable box blur, repeated, over the bounds grown by the blur reach. Outside the document the edge value repeats. */
export function featherMask(mask: Mask, feather: number): Mask {
  const { width, height, bounds } = mask;
  if (!bounds || feather <= 0) return mask;
  const passes = PARAMS.mask.featherPasses;
  const radius = Math.max(1, Math.round(Math.min(feather, PARAMS.mask.maxFeather) / passes));
  const reach = radius * passes;
  const rx0 = Math.max(0, bounds.x - reach);
  const ry0 = Math.max(0, bounds.y - reach);
  const rx1 = Math.min(width, bounds.x + bounds.w + reach);
  const ry1 = Math.min(height, bounds.y + bounds.h + reach);
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  const buf = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    const src = (ry0 + y) * width + rx0;
    for (let x = 0; x < rw; x++) buf[y * rw + x] = mask.data[src + x];
  }
  const line = new Float32Array(Math.max(rw, rh));
  const out = new Float32Array(Math.max(rw, rh));
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) line[x] = buf[y * rw + x];
      boxLine(line, out, rw, radius);
      for (let x = 0; x < rw; x++) buf[y * rw + x] = out[x];
    }
    for (let x = 0; x < rw; x++) {
      for (let y = 0; y < rh; y++) line[y] = buf[y * rw + x];
      boxLine(line, out, rh, radius);
      for (let y = 0; y < rh; y++) buf[y * rw + x] = out[y];
    }
  }
  const data = new Uint8Array(width * height);
  for (let y = 0; y < rh; y++) {
    const dst = (ry0 + y) * width + rx0;
    for (let x = 0; x < rw; x++) data[dst + x] = Math.round(buf[y * rw + x]);
  }
  return maskFromData(width, height, data);
}

/** Running-sum box blur of n values with edge clamp. */
function boxLine(src: Float32Array, dst: Float32Array, n: number, radius: number): void {
  if (n === 0) return;
  const size = radius * 2 + 1;
  const last = n - 1;
  let sum = 0;
  for (let i = -radius; i <= radius; i++) sum += src[clampInt(i, 0, last)];
  for (let i = 0; i < n; i++) {
    dst[i] = sum / size;
    sum += src[clampInt(i + radius + 1, 0, last)] - src[clampInt(i - radius, 0, last)];
  }
}

/**
 * Combines the current selection `a` with `b`. A null `a` is "no selection": add and replace give b, subtract and
 * intersect give nothing. Returns null when the result is empty.
 */
export function combineMask(a: Mask | null, b: Mask, op: MaskOp): Mask | null {
  if (op === 'replace' || (!a && op === 'add')) return b.bounds ? b : null;
  if (!a) return null;
  if (a.width !== b.width || a.height !== b.height) throw new RangeError('combineMask needs two masks of the same size.');
  const n = a.data.length;
  const data = new Uint8Array(n);
  const ad = a.data;
  const bd = b.data;
  if (op === 'add') for (let i = 0; i < n; i++) data[i] = ad[i] > bd[i] ? ad[i] : bd[i];
  else if (op === 'subtract') for (let i = 0; i < n; i++) data[i] = Math.round((ad[i] * (255 - bd[i])) / 255);
  else for (let i = 0; i < n; i++) data[i] = Math.round((ad[i] * bd[i]) / 255);
  const mask = maskFromData(a.width, a.height, data);
  return mask.bounds ? mask : null;
}

/** The inverse coverage. A null mask means everything, so its inverse is an empty mask. */
export function invertMask(m: Mask | null, w: number, h: number): Mask {
  const [width, height] = sanitizeSize(w, h);
  const data = new Uint8Array(width * height);
  if (m) {
    if (m.width !== width || m.height !== height) throw new RangeError('invertMask needs the mask size.');
    for (let i = 0; i < data.length; i++) data[i] = 255 - m.data[i];
  }
  return maskFromData(width, height, data);
}

/** The mask moved by (dx, dy) whole px onto a w x h document; the part outside drops. Null when nothing stays. */
export function translateMask(m: Mask, dx: number, dy: number, w: number, h: number): Mask | null {
  const [width, height] = sanitizeSize(w, h);
  const data = new Uint8Array(width * height);
  const ox = Math.round(dx);
  const oy = Math.round(dy);
  const x0 = Math.max(0, ox);
  const x1 = Math.min(width, m.width + ox);
  if (x1 > x0) {
    for (let y = Math.max(0, oy); y < Math.min(height, m.height + oy); y++) {
      const src = (y - oy) * m.width + (x0 - ox);
      data.set(m.data.subarray(src, src + (x1 - x0)), y * width + x0);
    }
  }
  const mask = maskFromData(width, height, data);
  return mask.bounds ? mask : null;
}

/** 255 when m is null; 0 outside the mask. */
export function coverage(m: Mask | null, x: number, y: number): number {
  if (!m) return 255;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= m.width || iy >= m.height) return 0;
  return m.data[iy * m.width + ix];
}

const OUTLINE_LEVEL = 128;

/**
 * Closed polylines (x0, y0, x1, y1, ...; the last point joins the first) of the coverage-128 contour, in document px.
 * Marching squares over the pixel centers, with zero outside the document; straight runs collapse to their ends.
 */
export function maskOutline(m: Mask): Float32Array[] {
  const { width, height, data, bounds } = m;
  if (!bounds) return [];
  // Sample grid G with one zero sample of padding on each side: G(i, j) is the pixel (i - 1, j - 1).
  const gi0 = bounds.x;
  const gj0 = bounds.y;
  const gi1 = bounds.x + bounds.w + 1;
  const gj1 = bounds.y + bounds.h + 1;
  const stride = width + 2;
  const sample = (i: number, j: number): number => {
    const x = i - 1;
    const y = j - 1;
    return x < 0 || y < 0 || x >= width || y >= height ? 0 : data[y * width + x];
  };
  // Edge ids: horizontal edge from G(i, j) to G(i + 1, j) is (j * stride + i) * 2; vertical edge to G(i, j + 1) is + 1.
  const hEdge = (i: number, j: number) => (j * stride + i) * 2;
  const vEdge = (i: number, j: number) => (j * stride + i) * 2 + 1;
  const links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    const la = links.get(a);
    if (la) la.push(b);
    else links.set(a, [b]);
    const lb = links.get(b);
    if (lb) lb.push(a);
    else links.set(b, [a]);
  };
  for (let j = gj0; j < gj1; j++) {
    for (let i = gi0; i < gi1; i++) {
      const tl = sample(i, j);
      const tr = sample(i + 1, j);
      const br = sample(i + 1, j + 1);
      const bl = sample(i, j + 1);
      const index = (tl >= OUTLINE_LEVEL ? 8 : 0) | (tr >= OUTLINE_LEVEL ? 4 : 0) | (br >= OUTLINE_LEVEL ? 2 : 0) | (bl >= OUTLINE_LEVEL ? 1 : 0);
      if (index === 0 || index === 15) continue;
      const top = hEdge(i, j);
      const bottom = hEdge(i, j + 1);
      const left = vEdge(i, j);
      const right = vEdge(i + 1, j);
      switch (index) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(top, right); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(left, top); break;
        case 5: case 10: {
          const center = (tl + tr + br + bl) / 4 >= OUTLINE_LEVEL;
          // 5: tr and bl inside; 10: tl and br inside.
          if ((index === 5) === center) {
            link(left, top);
            link(bottom, right);
          } else {
            link(left, bottom);
            link(top, right);
          }
          break;
        }
      }
    }
  }
  const point = (edge: number): [number, number] => {
    const vertical = edge & 1;
    const cell = edge >> 1;
    const j = Math.floor(cell / stride);
    const i = cell - j * stride;
    const a = sample(i, j);
    const b = vertical ? sample(i, j + 1) : sample(i + 1, j);
    const t = a === b ? 0.5 : (OUTLINE_LEVEL - a) / (b - a);
    // Pixel center of G(i, j) is at document (i - 0.5, j - 0.5).
    return vertical ? [i - 0.5, j - 0.5 + t] : [i - 0.5 + t, j - 0.5];
  };
  const visited = new Set<number>();
  const lines: Float32Array[] = [];
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    const loop: number[] = [];
    let previous = -1;
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      loop.push(current);
      const next = (links.get(current) ?? []).find((edge) => edge !== previous && !visited.has(edge));
      if (next === undefined) break;
      previous = current;
      current = next;
    }
    if (loop.length >= 2) lines.push(simplify(loop.map(point)));
  }
  return lines;
}

/** Drops each point that lies on the straight line of its two neighbors (closed polyline). */
function simplify(points: [number, number][]): Float32Array {
  const n = points.length;
  const kept: number[] = [];
  for (let k = 0; k < n; k++) {
    const [px, py] = points[(k + n - 1) % n];
    const [x, y] = points[k];
    const [nx, ny] = points[(k + 1) % n];
    const cross = (x - px) * (ny - py) - (y - py) * (nx - px);
    if (n > 3 && Math.abs(cross) < 1e-6) continue;
    kept.push(x, y);
  }
  return Float32Array.from(kept.length >= 4 ? kept : points.flat());
}
