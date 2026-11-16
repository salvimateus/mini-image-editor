import type { Rect } from '../types.ts';

/**
 * One pyramid level: premultiplied RGBA8 and a hole flag (1 = hole) for each pixel. `bounds` holds every hole pixel.
 * `texture` holds two channels per pixel, the local |dL/dx| and |dL/dy| energy (0..255), or null on a level that does
 * not compare it.
 */
export interface Level {
  width: number;
  height: number;
  data: Uint8Array;
  hole: Uint8Array;
  bounds: Rect;
  texture: Uint8Array | null;
}

export function premultiply(src: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3];
    if (a === 255) {
      out[i] = src[i];
      out[i + 1] = src[i + 1];
      out[i + 2] = src[i + 2];
      out[i + 3] = 255;
    } else if (a !== 0) {
      out[i] = Math.round((src[i] * a) / 255);
      out[i + 1] = Math.round((src[i + 1] * a) / 255);
      out[i + 2] = Math.round((src[i + 2] * a) / 255);
      out[i + 3] = a;
    }
  }
  return out;
}

/** The bounds of the hole flags, or null when there is no hole pixel. */
export function holeBounds(hole: Uint8Array, width: number, height: number): Rect | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      if (!hole[i]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The input of `reduceLevel`: a level, or straight-alpha pixels with `straight` set. */
export interface LevelSource {
  width: number;
  height: number;
  data: ArrayLike<number>;
  hole: Uint8Array;
  bounds: Rect;
  texture?: Uint8Array | null;
}

/**
 * Reduces a level by an integer factor. A reduced pixel is the mean of the known pixels of its block, so the colors of
 * the hole never reach the known ring. A block is hole when any of its pixels is hole. With `straight`, the source
 * pixels are straight alpha and are premultiplied on the way.
 */
export function reduceLevel(source: LevelSource, factor: number, straight = false): Level {
  const { width, height, data, hole, bounds } = source;
  const texture = source.texture ?? null;
  const w = Math.ceil(width / factor);
  const h = Math.ceil(height / factor);
  const out = new Uint8Array(w * h * 4);
  const outHole = new Uint8Array(w * h);
  const outTexture = texture ? new Uint8Array(w * h * 2) : null;
  for (let y = 0; y < h; y++) {
    const sy0 = y * factor;
    const sy1 = Math.min(height, sy0 + factor);
    for (let x = 0; x < w; x++) {
      const sx0 = x * factor;
      const sx1 = Math.min(width, sx0 + factor);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let tx = 0;
      let ty = 0;
      let count = 0;
      let isHole = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0, i = sy * width + sx0; sx < sx1; sx++, i++) {
          if (hole[i]) {
            isHole = 1;
            continue;
          }
          const o = i * 4;
          const alpha = data[o + 3];
          const unit = straight ? alpha / 255 : 1;
          r += data[o] * unit;
          g += data[o + 1] * unit;
          b += data[o + 2] * unit;
          a += alpha;
          if (texture) {
            tx += texture[i * 2];
            ty += texture[i * 2 + 1];
          }
          count++;
        }
      }
      const i = y * w + x;
      outHole[i] = isHole;
      if (count) {
        const o = i * 4;
        out[o] = Math.round(r / count);
        out[o + 1] = Math.round(g / count);
        out[o + 2] = Math.round(b / count);
        out[o + 3] = Math.round(a / count);
        if (outTexture) {
          outTexture[i * 2] = Math.round(tx / count);
          outTexture[i * 2 + 1] = Math.round(ty / count);
        }
      }
    }
  }
  const x0 = Math.floor(bounds.x / factor);
  const y0 = Math.floor(bounds.y / factor);
  const x1 = Math.ceil((bounds.x + bounds.w) / factor);
  const y1 = Math.ceil((bounds.y + bounds.h) / factor);
  return { width: w, height: h, data: out, hole: outHole, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, texture: outTexture };
}

/**
 * Sets `level.texture`: the means of |dL/dx| and of |dL/dy| (luma) over the known pixels of a (2 * radius + 1) window,
 * times `gain`. Colors alone cannot tell a fine or oriented texture (grass, thin ribbons) from a flat area of the same
 * mean color once a level is reduced; these channels keep that difference and its direction.
 */
export function computeTexture(level: Level, radius: number, gain: number): void {
  const { width, height, data, hole } = level;
  const n = width * height;
  const luma = (i: number): number => data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
  const grad = new Float32Array(n * 2);
  const has = new Uint8Array(n);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1, i = y * width + 1; x < width - 1; x++, i++) {
      if (hole[i] || hole[i - 1] || hole[i + 1] || hole[i - width] || hole[i + width]) continue;
      grad[i * 2] = Math.abs(luma(i + 1) - luma(i - 1));
      grad[i * 2 + 1] = Math.abs(luma(i + width) - luma(i - width));
      has[i] = 1;
    }
  }
  const across = new Float32Array(n * 2);
  const acrossCount = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sx = 0;
    let sy = 0;
    let count = 0;
    const add = (i: number, sign: number): void => {
      sx += grad[i * 2] * sign;
      sy += grad[i * 2 + 1] * sign;
      count += has[i] * sign;
    };
    for (let x = 0; x < Math.min(radius, width); x++) add(row + x, 1);
    for (let x = 0; x < width; x++) {
      if (x + radius < width) add(row + x + radius, 1);
      across[(row + x) * 2] = sx;
      across[(row + x) * 2 + 1] = sy;
      acrossCount[row + x] = count;
      if (x - radius >= 0) add(row + x - radius, -1);
    }
  }
  const texture = new Uint8Array(n * 2);
  const columnX = new Float64Array(width);
  const columnY = new Float64Array(width);
  const columnCount = new Int32Array(width);
  const addRow = (y: number, sign: number): void => {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      columnX[x] += across[(row + x) * 2] * sign;
      columnY[x] += across[(row + x) * 2 + 1] * sign;
      columnCount[x] += acrossCount[row + x] * sign;
    }
  };
  for (let y = 0; y < Math.min(radius, height); y++) addRow(y, 1);
  for (let y = 0; y < height; y++) {
    if (y + radius < height) addRow(y + radius, 1);
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const count = columnCount[x];
      if (count <= 0 || hole[row + x]) continue;
      texture[(row + x) * 2] = Math.min(255, Math.round((Math.max(0, columnX[x]) / count) * gain));
      texture[(row + x) * 2 + 1] = Math.min(255, Math.round((Math.max(0, columnY[x]) / count) * gain));
    }
    if (y - radius >= 0) addRow(y - radius, -1);
  }
  level.texture = texture;
}

/**
 * The largest distance from a hole pixel to the nearest known pixel (chamfer 3-4), in px: the thickness of the hole,
 * not of its bounding box. The area outside the level is not known. Infinity when no pixel is known.
 */
export function holeInradius(level: Level): number {
  const { width, height, hole, bounds } = level;
  const x0 = Math.max(0, bounds.x - 1);
  const y0 = Math.max(0, bounds.y - 1);
  const x1 = Math.min(width, bounds.x + bounds.w + 1);
  const y1 = Math.min(height, bounds.y + bounds.h + 1);
  const w = x1 - x0;
  const h = y1 - y0;
  const far = 0x3fffffff;
  const dist = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0, i = y * w; x < w; x++, i++) dist[i] = hole[(y + y0) * width + x + x0] ? far : 0;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0, i = y * w; x < w; x++, i++) {
      let d = dist[i];
      if (d === 0) continue;
      if (x > 0) d = Math.min(d, dist[i - 1] + 3);
      if (y > 0) {
        d = Math.min(d, dist[i - w] + 3);
        if (x > 0) d = Math.min(d, dist[i - w - 1] + 4);
        if (x < w - 1) d = Math.min(d, dist[i - w + 1] + 4);
      }
      dist[i] = d;
    }
  }
  let max = 0;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1, i = y * w + x; x >= 0; x--, i--) {
      let d = dist[i];
      if (d === 0) continue;
      if (x < w - 1) d = Math.min(d, dist[i + 1] + 3);
      if (y < h - 1) {
        d = Math.min(d, dist[i + w] + 3);
        if (x < w - 1) d = Math.min(d, dist[i + w + 1] + 4);
        if (x > 0) d = Math.min(d, dist[i + w - 1] + 4);
      }
      dist[i] = d;
      if (d > max) max = d;
    }
  }
  return max >= far ? Infinity : max / 3;
}

/** Bilinear sample of premultiplied RGBA at a fractional pixel position (pixel centers at integers), into `out`. */
export function sampleBilinear(level: Level, fx: number, fy: number, out: Float32Array): void {
  const { width, height, data } = level;
  const cx = Math.min(width - 1, Math.max(0, fx));
  const cy = Math.min(height - 1, Math.max(0, fy));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = cx - x0;
  const ty = cy - y0;
  const a = (y0 * width + x0) * 4;
  const b = (y0 * width + x1) * 4;
  const c = (y1 * width + x0) * 4;
  const d = (y1 * width + x1) * 4;
  for (let k = 0; k < 4; k++) {
    const top = data[a + k] + (data[b + k] - data[a + k]) * tx;
    const bottom = data[c + k] + (data[d + k] - data[c + k]) * tx;
    out[k] = top + (bottom - top) * ty;
  }
}
