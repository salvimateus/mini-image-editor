import type { Level } from './pyramid.ts';

export interface SeamOptions {
  /** Side of one cell of the correction grid, in level px. */
  cellPx: number;
  /** Largest error of one border pixel per channel, so a strong edge at the border does not tint the fill. */
  clamp: number;
  /** Over-relaxed Gauss-Seidel sweeps of the membrane. */
  iterations: number;
  /** Over-relaxation factor of each sweep (1..2). */
  relax: number;
}

/**
 * Corrects the color of a filled hole so that it agrees with the known pixels at its border. The error between each
 * border hole pixel and its known neighbours is averaged on a coarse grid, the grid cells inside the hole get the
 * membrane (Laplace) interpolation of the border cells, and each hole pixel adds the bilinear sample of that grid. The
 * correction is smooth, so the texture of the fill stays. Works on premultiplied RGBA and changes `level.data`.
 */
export function matchBorder(level: Level, options: SeamOptions): void {
  const { width, height, data, hole, bounds } = level;
  const { cellPx, clamp, iterations, relax } = options;
  const ox = bounds.x - 1;
  const oy = bounds.y - 1;
  const gw = Math.ceil((bounds.w + 2) / cellPx);
  const gh = Math.ceil((bounds.h + 2) / cellPx);
  const cells = gw * gh;
  const sum = new Float64Array(cells * 4);
  const count = new Int32Array(cells);
  const domain = new Uint8Array(cells);

  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    const cy = Math.floor((y - oy) / cellPx);
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const p = y * width + x;
      if (!hole[p]) continue;
      const cell = cy * gw + Math.floor((x - ox) / cellPx);
      domain[cell] = 1;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const i = ny * width + nx;
          if (hole[i]) continue;
          r += data[i * 4];
          g += data[i * 4 + 1];
          b += data[i * 4 + 2];
          a += data[i * 4 + 3];
          n++;
        }
      }
      if (n === 0) continue;
      const o = p * 4;
      const c = cell * 4;
      sum[c] += Math.max(-clamp, Math.min(clamp, r / n - data[o]));
      sum[c + 1] += Math.max(-clamp, Math.min(clamp, g / n - data[o + 1]));
      sum[c + 2] += Math.max(-clamp, Math.min(clamp, b / n - data[o + 2]));
      sum[c + 3] += Math.max(-clamp, Math.min(clamp, a / n - data[o + 3]));
      count[cell]++;
    }
  }

  // Border cells are fixed; the other hole cells start at the mean border error and relax toward their neighbours.
  const value = new Float32Array(cells * 4);
  const mean = [0, 0, 0, 0];
  let fixedCount = 0;
  for (let k = 0; k < cells; k++) {
    if (!count[k]) continue;
    fixedCount++;
    for (let c = 0; c < 4; c++) {
      value[k * 4 + c] = sum[k * 4 + c] / count[k];
      mean[c] += value[k * 4 + c];
    }
  }
  if (fixedCount === 0) return;
  for (let k = 0; k < cells; k++) {
    if (domain[k] && !count[k]) for (let c = 0; c < 4; c++) value[k * 4 + c] = mean[c] / fixedCount;
  }
  // The free cells and their hole neighbours, listed once: a sweep then reads only flat arrays.
  const free: number[] = [];
  const links: number[] = [];
  for (let k = 0; k < cells; k++) {
    if (!domain[k] || count[k]) continue;
    const cx = k % gw;
    const cy = (k - cx) / gw;
    const start = links.length;
    if (cx > 0 && domain[k - 1]) links.push(k - 1);
    if (cx < gw - 1 && domain[k + 1]) links.push(k + 1);
    if (cy > 0 && domain[k - gw]) links.push(k - gw);
    if (cy < gh - 1 && domain[k + gw]) links.push(k + gw);
    if (links.length > start) free.push(k, start, links.length - start);
  }
  const freeCells = Int32Array.from(free);
  const neighbours = Int32Array.from(links);
  for (let sweep = 0; sweep < iterations; sweep++) {
    for (let f = 0; f < freeCells.length; f += 3) {
      const o = freeCells[f] * 4;
      const start = freeCells[f + 1];
      const n = freeCells[f + 2];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let j = start; j < start + n; j++) {
        const q = neighbours[j] * 4;
        r += value[q];
        g += value[q + 1];
        b += value[q + 2];
        a += value[q + 3];
      }
      value[o] += relax * (r / n - value[o]);
      value[o + 1] += relax * (g / n - value[o + 1]);
      value[o + 2] += relax * (b / n - value[o + 2]);
      value[o + 3] += relax * (a / n - value[o + 3]);
    }
  }

  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    const fy = (y - oy + 0.5) / cellPx - 0.5;
    const y0 = Math.max(0, Math.min(gh - 1, Math.floor(fy)));
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = Math.max(0, Math.min(1, fy - y0));
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const p = y * width + x;
      if (!hole[p]) continue;
      const fx = (x - ox + 0.5) / cellPx - 0.5;
      const x0 = Math.max(0, Math.min(gw - 1, Math.floor(fx)));
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = Math.max(0, Math.min(1, fx - x0));
      // Bilinear over the hole cells only; a cell with no hole pixel has no value.
      const k00 = y0 * gw + x0;
      const k01 = y0 * gw + x1;
      const k10 = y1 * gw + x0;
      const k11 = y1 * gw + x1;
      const w00 = domain[k00] * (1 - tx) * (1 - ty);
      const w01 = domain[k01] * tx * (1 - ty);
      const w10 = domain[k10] * (1 - tx) * ty;
      const w11 = domain[k11] * tx * ty;
      const total = w00 + w01 + w10 + w11;
      if (total <= 0) continue;
      const o = p * 4;
      const alpha = Math.max(0, Math.min(255, data[o + 3] + (value[k00 * 4 + 3] * w00 + value[k01 * 4 + 3] * w01 + value[k10 * 4 + 3] * w10 + value[k11 * 4 + 3] * w11) / total));
      for (let c = 0; c < 3; c++) {
        const shift = (value[k00 * 4 + c] * w00 + value[k01 * 4 + c] * w01 + value[k10 * 4 + c] * w10 + value[k11 * 4 + c] * w11) / total;
        data[o + c] = Math.round(Math.max(0, Math.min(alpha, data[o + c] + shift)));
      }
      data[o + 3] = Math.round(alpha);
    }
  }
}
