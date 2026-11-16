import type { Rect } from '../types.ts';
import type { Level } from './pyramid.ts';

/** A seeded generator of floats in [0, 1) (mulberry32), so a fill repeats for the same input. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The nearest-neighbour field of one level. A target is a patch center whose window holds a hole pixel; its match is
 * the center of a source patch (a window fully inside the level, with no hole pixel). Indices are level pixel indices.
 */
export interface Field {
  level: Level;
  radius: number;
  /** 1 where a source patch can be centered. */
  valid: Uint8Array;
  validCount: number;
  /** Every valid source; null on a large level, where a random source comes from rejection sampling. */
  validList: Int32Array | null;
  targets: Int32Array;
  /** For each target, in the order of `targets`. */
  match: Int32Array;
  dist: Float32Array;
  /** The target slot of each pixel of `box`, or -1. */
  slot: Int32Array;
  /** The hole bounds grown by the patch radius, inside the level. */
  box: Rect;
  /** Weight of each texture channel in the patch distance, when the level has them. */
  textureWeight: number;
  /** Weight of a known target pixel in the patch distance; a hole pixel weighs 1. */
  knownWeight: number;
  /** For each target, the sum of the pixel weights of its window. */
  norm: Float32Array;
}

/** Marks each pixel whose window (clipped to the level) holds a hole pixel, with two sliding-window passes. */
function holeNearby(level: Level, radius: number): Uint8Array {
  const { width, height, hole } = level;
  const across = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x < Math.min(radius, width); x++) count += hole[row + x];
    for (let x = 0; x < width; x++) {
      if (x + radius < width) count += hole[row + x + radius];
      across[row + x] = count > 0 ? 1 : 0;
      if (x - radius >= 0) count -= hole[row + x - radius];
    }
  }
  const near = new Uint8Array(width * height);
  const column = new Int32Array(width);
  const addRow = (y: number, sign: number): void => {
    const row = y * width;
    for (let x = 0; x < width; x++) column[x] += across[row + x] * sign;
  };
  for (let y = 0; y < Math.min(radius, height); y++) addRow(y, 1);
  for (let y = 0; y < height; y++) {
    if (y + radius < height) addRow(y + radius, 1);
    const row = y * width;
    for (let x = 0; x < width; x++) near[row + x] = column[x] > 0 ? 1 : 0;
    if (y - radius >= 0) addRow(y - radius, -1);
  }
  return near;
}

/** The source map of a level for a patch radius: 1 where a window fits inside the level with no hole pixel. */
export function sourceMap(level: Level, radius: number, listSources: boolean): { valid: Uint8Array; validCount: number; validList: Int32Array | null } {
  const { width, height } = level;
  const valid = holeNearby(level, radius);
  let validCount = 0;
  for (let y = 0; y < height; y++) {
    const inside = y >= radius && y < height - radius;
    for (let x = 0, i = y * width; x < width; x++, i++) {
      const ok = inside && x >= radius && x < width - radius && !valid[i];
      valid[i] = ok ? 1 : 0;
      if (ok) validCount++;
    }
  }
  let validList: Int32Array | null = null;
  if (listSources) {
    validList = new Int32Array(validCount);
    for (let i = 0, k = 0; i < valid.length; i++) if (valid[i]) validList[k++] = i;
  }
  return { valid, validCount, validList };
}

/** Builds the sources and the targets of a level. `listSources` also keeps the list of every valid source. */
export function createField(level: Level, radius: number, listSources: boolean, textureWeight: number, knownWeight: number): Field {
  const { width, height, bounds } = level;
  const near = holeNearby(level, radius);
  const bx0 = Math.max(0, bounds.x - radius);
  const by0 = Math.max(0, bounds.y - radius);
  const bx1 = Math.min(width, bounds.x + bounds.w + radius);
  const by1 = Math.min(height, bounds.y + bounds.h + radius);
  const box = { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
  const slot = new Int32Array(box.w * box.h).fill(-1);
  let targetCount = 0;
  for (let y = by0, b = 0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++, b++) if (near[y * width + x]) slot[b] = targetCount++;
  }
  const targets = new Int32Array(targetCount);
  for (let y = by0, b = 0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++, b++) if (slot[b] >= 0) targets[slot[b]] = y * width + x;
  }

  // The same buffer becomes the source map: no hole in the window, and the window inside the level.
  const valid = near;
  let validCount = 0;
  for (let y = 0; y < height; y++) {
    const inside = y >= radius && y < height - radius;
    for (let x = 0, i = y * width; x < width; x++, i++) {
      const ok = inside && x >= radius && x < width - radius && !near[i];
      valid[i] = ok ? 1 : 0;
      if (ok) validCount++;
    }
  }
  let validList: Int32Array | null = null;
  if (listSources) {
    validList = new Int32Array(validCount);
    for (let i = 0, k = 0; i < valid.length; i++) if (valid[i]) validList[k++] = i;
  }
  return {
    level,
    radius,
    valid,
    validCount,
    validList,
    targets,
    match: new Int32Array(targets.length).fill(-1),
    dist: new Float32Array(targets.length),
    slot,
    box,
    textureWeight,
    knownWeight,
    norm: windowNorms(level, radius, targets, knownWeight),
  };
}

function windowNorms(level: Level, radius: number, targets: Int32Array, knownWeight: number): Float32Array {
  const { width, height, hole } = level;
  const norm = new Float32Array(targets.length);
  for (let k = 0; k < targets.length; k++) {
    const t = targets[k];
    const tx = t % width;
    const ty = (t - tx) / width;
    let total = 0;
    for (let y = Math.max(0, ty - radius); y <= Math.min(height - 1, ty + radius); y++) {
      for (let x = Math.max(0, tx - radius), i = y * width + x; x <= Math.min(width - 1, tx + radius); x++, i++) total += hole[i] ? 1 : knownWeight;
    }
    norm[k] = total;
  }
  return norm;
}

/** The patch distance of target slot `k` (at `t`) to source `s`. Infinity once it passes `cutoff`. */
function matchCost(field: Field, k: number, t: number, s: number, cutoff: number): number {
  return patchDistance(field.level, field.textureWeight, field.knownWeight, field.radius, t, s, field.norm[k], cutoff);
}

/** A random valid source. Call only when the map has a valid source. */
function randomSource(field: { valid: Uint8Array; validList: Int32Array | null }, random: () => number): number {
  const { valid, validList } = field;
  if (validList) return validList[Math.floor(random() * validList.length)];
  for (let tries = 0; tries < 256; tries++) {
    const i = Math.floor(random() * valid.length);
    if (valid[i]) return i;
  }
  const start = Math.floor(random() * valid.length);
  for (let k = 0; k < valid.length; k++) {
    const i = (start + k) % valid.length;
    if (valid[i]) return i;
  }
  return -1;
}

/**
 * Weighted mean squared difference per pixel of the windows at target `t` and source `s`, over premultiplied RGBA plus
 * the texture channels when the level has them. A known target pixel weighs `knownWeight`, a hole pixel 1, and `norm`
 * is the sum of those weights over the window. The target window is clipped to the level; the source window is always
 * inside. Infinity once the weighted sum passes `cutoff * norm`.
 */
function patchDistance(level: Level, textureWeight: number, knownWeight: number, radius: number, t: number, s: number, norm: number, cutoff: number): number {
  const { data, width, height, texture, hole } = level;
  const tx = t % width;
  const ty = (t - tx) / width;
  const x0 = tx < radius ? -tx : -radius;
  const x1 = tx + radius >= width ? width - 1 - tx : radius;
  const y0 = ty < radius ? -ty : -radius;
  const y1 = ty + radius >= height ? height - 1 - ty : radius;
  const start = t + y0 * width + x0;
  const offset = s - t;
  if (texture) return textureDistance(data, texture, hole, width, x1 - x0 + 1, y1 - y0 + 1, start, offset, textureWeight, knownWeight, norm, cutoff * norm);
  const span = x1 - x0 + 1;
  const rows = y1 - y0 + 1;
  // A window with no known pixel has norm = its size: skip the weights.
  if (norm === span * rows) return plainDistance(data, width, span, rows, start, offset, cutoff);
  return colorDistance(data, hole, width, span, rows, start, offset, knownWeight, norm, cutoff * norm);
}

function plainDistance(data: Uint8Array, width: number, span: number, rows: number, start: number, offset: number, cutoff: number): number {
  const pixels = span * rows;
  const limit = cutoff * pixels;
  let sum = 0;
  for (let row = 0; row < rows; row++) {
    let ti = (start + row * width) * 4;
    let si = ti + offset * 4;
    const end = ti + span * 4;
    while (ti < end) {
      const d0 = data[ti] - data[si];
      const d1 = data[ti + 1] - data[si + 1];
      const d2 = data[ti + 2] - data[si + 2];
      const d3 = data[ti + 3] - data[si + 3];
      sum += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
      ti += 4;
      si += 4;
    }
    if (sum > limit) return Infinity;
  }
  return sum / pixels;
}

// A known pixel weighs knownWeight and a hole pixel 1, with no branch: knownWeight - (knownWeight - 1) * hole.
function colorDistance(data: Uint8Array, hole: Uint8Array, width: number, span: number, rows: number, start: number, offset: number, knownWeight: number, norm: number, limit: number): number {
  const extra = knownWeight - 1;
  let sum = 0;
  for (let row = 0, tp = start; row < rows; row++, tp += width - span) {
    const end = tp + span;
    let ti = tp * 4;
    let si = (tp + offset) * 4;
    for (; tp < end; tp++, ti += 4, si += 4) {
      const d0 = data[ti] - data[si];
      const d1 = data[ti + 1] - data[si + 1];
      const d2 = data[ti + 2] - data[si + 2];
      const d3 = data[ti + 3] - data[si + 3];
      sum += (d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3) * (knownWeight - extra * hole[tp]);
    }
    if (sum > limit) return Infinity;
  }
  return sum / norm;
}

function textureDistance(data: Uint8Array, texture: Uint8Array, hole: Uint8Array, width: number, span: number, rows: number, start: number, offset: number, textureWeight: number, knownWeight: number, norm: number, limit: number): number {
  const extra = knownWeight - 1;
  let sum = 0;
  for (let row = 0, tp = start; row < rows; row++, tp += width - span) {
    const end = tp + span;
    let ti = tp * 4;
    let si = (tp + offset) * 4;
    let tg = tp * 2;
    let sg = (tp + offset) * 2;
    for (; tp < end; tp++, ti += 4, si += 4, tg += 2, sg += 2) {
      const d0 = data[ti] - data[si];
      const d1 = data[ti + 1] - data[si + 1];
      const d2 = data[ti + 2] - data[si + 2];
      const d3 = data[ti + 3] - data[si + 3];
      const gx = texture[tg] - texture[sg];
      const gy = texture[tg + 1] - texture[sg + 1];
      sum += (d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3 + textureWeight * (gx * gx + gy * gy)) * (knownWeight - extra * hole[tp]);
    }
    if (sum > limit) return Infinity;
  }
  return sum / norm;
}

/**
 * As `patchDistance`, but only over the target pixels that `known` marks; `pixels` is their count in the window. Only
 * the row offsets in `rows[0..rowCount)` are read: the rows with known pixels, the fullest first, so a poor source
 * stops early. Infinity once the sum passes `cutoff` or when the window has no known pixel.
 */
function knownDistance(level: Level, weight: number, known: Uint8Array, radius: number, t: number, s: number, pixels: number, rows: Int32Array, rowCount: number, cutoff: number): number {
  if (pixels === 0) return Infinity;
  const { data, width, texture } = level;
  const tx = t % width;
  const x0 = tx < radius ? -tx : -radius;
  const x1 = tx + radius >= width ? width - 1 - tx : radius;
  const limit = cutoff * pixels;
  const span = x1 - x0 + 1;
  let sum = 0;
  for (let r = 0; r < rowCount; r++) {
    const dy = rows[r];
    let tp = t + dy * width + x0;
    const end = tp + span;
    const offset = s - t;
    for (; tp < end; tp++) {
      if (!known[tp]) continue;
      const ti = tp * 4;
      const si = (tp + offset) * 4;
      const d0 = data[ti] - data[si];
      const d1 = data[ti + 1] - data[si + 1];
      const d2 = data[ti + 2] - data[si + 2];
      const d3 = data[ti + 3] - data[si + 3];
      let cost = d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
      if (texture) {
        const gx = texture[tp * 2] - texture[(tp + offset) * 2];
        const gy = texture[tp * 2 + 1] - texture[(tp + offset) * 2 + 1];
        cost += weight * (gx * gx + gy * gy);
      }
      sum += cost;
    }
    if (sum > limit) return Infinity;
  }
  return sum / pixels;
}

export interface StructureFillOptions {
  /** Patch radius of the fill; larger than the EM patch, so it sees how structures run. */
  radius: number;
  samples: number;
  /** Random sources near the patch, within `localPx` on each axis: the likeliest match in a large level. */
  localSamples: number;
  localPx: number;
  exhaustiveBudget: number;
  shrink: number;
  /** Floor of the data term, so a flat area still fills in confidence order. */
  dataFloor: number;
}

/**
 * Fills the hole of the coarsest level patch by patch (exemplar-based, Criminisi et al.). The next patch is the front
 * pixel with the highest confidence times data term, so lines that meet the hole edge (a horizon, a shore) run into it
 * first. Each step copies the missing pixels of the best source patch for the known pixels of the window. The search
 * is exhaustive when `exhaustiveBudget` allows, else it tries the shifted matches of filled neighbours, random sources
 * from the whole level and from near the patch, and a shrinking random search. Writes `level.data` and the matches of the hole pixels.
 */
export function structureFill(field: Field, random: () => number, options: StructureFillOptions): void {
  const { level, match, slot, box, textureWeight } = field;
  const { data, width, height, hole, bounds, texture } = level;
  const { samples, localSamples, localPx, exhaustiveBudget, shrink, dataFloor } = options;
  // A source window must fit the fill radius; fall back to the field radius when no such window exists.
  const own = sourceMap(level, options.radius, true);
  const sources = own.validCount > 0 ? own : field;
  const radius = own.validCount > 0 ? options.radius : field.radius;
  const { valid, validList } = sources;
  const known = new Uint8Array(width * height);
  const confidence = new Float32Array(width * height);
  let remaining = 0;
  for (let i = 0; i < known.length; i++) {
    if (hole[i]) remaining++;
    else {
      known[i] = 1;
      confidence[i] = 1;
    }
  }
  const area = (2 * radius + 1) * (2 * radius + 1);
  const steps = Math.ceil(remaining / Math.max(1, (radius + 1) * (radius + 1)));
  const exhaustive = validList !== null && validList.length * steps <= exhaustiveBudget;
  const searchStart = Math.max(width, height);
  const luma = (i: number): number => data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;

  const priority = new Float32Array(width * height);
  const inFront = new Uint8Array(width * height);
  let front: number[] = [];
  const isFront = (i: number, x: number, y: number): boolean => {
    if (known[i]) return false;
    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) if (known[ny * width + nx]) return true;
    }
    return false;
  };
  const priorityOf = (p: number): number => {
    const px = p % width;
    const py = (p - px) / width;
    let c = 0;
    let gx = 0;
    let gy = 0;
    let strongest = 0;
    let nx = 0;
    let ny = 0;
    for (let y = Math.max(0, py - radius); y <= Math.min(height - 1, py + radius); y++) {
      for (let x = Math.max(0, px - radius); x <= Math.min(width - 1, px + radius); x++) {
        const i = y * width + x;
        c += confidence[i];
        if (!known[i]) continue;
        // The front normal points from the known side into the hole.
        nx += x - px;
        ny += y - py;
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1 && known[i - 1] && known[i + 1] && known[i - width] && known[i + width]) {
          const ix = (luma(i + 1) - luma(i - 1)) / 2;
          const iy = (luma(i + width) - luma(i - width)) / 2;
          const m = ix * ix + iy * iy;
          if (m > strongest) {
            strongest = m;
            gx = ix;
            gy = iy;
          }
        }
      }
    }
    const norm = Math.hypot(nx, ny);
    // The isophote is the gradient turned by 90 degrees.
    const d = norm > 0 ? Math.abs(-gy * (nx / norm) + gx * (ny / norm)) / 255 : 0;
    return (c / area) * (d + dataFloor);
  };
  const addFront = (i: number): void => {
    if (inFront[i]) return;
    inFront[i] = 1;
    front.push(i);
  };
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const i = y * width + x;
      if (isFront(i, x, y)) addFront(i);
    }
  }
  for (const i of front) priority[i] = priorityOf(i);

  let t = 0;
  let pixels = 0;
  const rows = new Int32Array(2 * radius + 1);
  const rowKnown = new Int32Array(2 * radius + 1);
  let rowCount = 0;
  let best = -1;
  let bestDist = Infinity;
  const tryCandidate = (s: number): void => {
    if (s < 0 || s === best) return;
    const d = knownDistance(level, textureWeight, known, radius, t, s, pixels, rows, rowCount, bestDist);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  };

  while (remaining > 0 && front.length) {
    let pick = -1;
    let top = -1;
    let live = 0;
    for (let k = 0; k < front.length; k++) {
      const i = front[k];
      if (known[i]) {
        inFront[i] = 0;
        continue;
      }
      front[live++] = i;
      if (priority[i] > top) {
        top = priority[i];
        pick = i;
      }
    }
    front.length = live;
    if (pick < 0) break;

    t = pick;
    const tx = t % width;
    const ty = (t - tx) / width;
    const x0 = Math.max(0, tx - radius);
    const x1 = Math.min(width - 1, tx + radius);
    const y0 = Math.max(0, ty - radius);
    const y1 = Math.min(height - 1, ty + radius);
    pixels = 0;
    rowCount = 0;
    let c = 0;
    for (let y = y0; y <= y1; y++) {
      let inRow = 0;
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        inRow += known[i];
        c += confidence[i];
      }
      pixels += inRow;
      if (inRow === 0) continue;
      // Insertion by known count, fullest first.
      let at = rowCount++;
      while (at > 0 && rowKnown[at - 1] < inRow) {
        rows[at] = rows[at - 1];
        rowKnown[at] = rowKnown[at - 1];
        at--;
      }
      rows[at] = y - ty;
      rowKnown[at] = inRow;
    }
    best = -1;
    bestDist = Infinity;
    if (exhaustive && validList) {
      for (let v = 0; v < validList.length; v++) tryCandidate(validList[v]);
    } else {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * width + x;
          if (!hole[i] || !known[i]) continue;
          const m = match[slot[(y - box.y) * box.w + x - box.x]];
          if (m < 0) continue;
          const sx = (m % width) + tx - x;
          const sy = Math.floor(m / width) + ty - y;
          if (sx >= 0 && sy >= 0 && sx < width && sy < height && valid[sy * width + sx]) tryCandidate(sy * width + sx);
        }
      }
      for (let n = 0; n < samples; n++) tryCandidate(randomSource(sources, random));
      for (let n = 0; n < localSamples; n++) {
        const cx = Math.min(width - 1, Math.max(0, tx + Math.round((random() * 2 - 1) * localPx)));
        const cy = Math.min(height - 1, Math.max(0, ty + Math.round((random() * 2 - 1) * localPx)));
        if (valid[cy * width + cx]) tryCandidate(cy * width + cx);
      }
      for (let r = searchStart; r >= 1 && best >= 0; r *= shrink) {
        const cx0 = best % width;
        const cy0 = (best - cx0) / width;
        const cx = Math.min(width - 1, Math.max(0, cx0 + Math.round((random() * 2 - 1) * r)));
        const cy = Math.min(height - 1, Math.max(0, cy0 + Math.round((random() * 2 - 1) * r)));
        if (valid[cy * width + cx]) tryCandidate(cy * width + cx);
      }
    }
    if (best < 0) best = randomSource(sources, random);

    const filledConfidence = c / area;
    const offset = best - t;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        if (known[i]) continue;
        const s = i + offset;
        data.copyWithin(i * 4, s * 4, s * 4 + 4);
        if (texture) {
          texture[i * 2] = texture[s * 2];
          texture[i * 2 + 1] = texture[s * 2 + 1];
        }
        known[i] = 1;
        confidence[i] = filledConfidence;
        match[slot[(y - box.y) * box.w + x - box.x]] = field.valid[s] ? s : best;
        remaining--;
      }
    }
    for (let y = Math.max(0, y0 - 1); y <= Math.min(height - 1, y1 + 1); y++) {
      for (let x = Math.max(0, x0 - 1); x <= Math.min(width - 1, x1 + 1); x++) {
        const i = y * width + x;
        if (isFront(i, x, y)) addFront(i);
      }
    }
    for (let y = Math.max(0, y0 - radius - 1); y <= Math.min(height - 1, y1 + radius + 1); y++) {
      for (let x = Math.max(0, x0 - radius - 1); x <= Math.min(width - 1, x1 + radius + 1); x++) {
        const i = y * width + x;
        if (inFront[i] && !known[i]) priority[i] = priorityOf(i);
      }
    }
  }
}

export function randomMatches(field: Field, random: () => number): void {
  const { match } = field;
  for (let k = 0; k < match.length; k++) match[k] = randomSource(field, random);
}

const RANDOM_MATCH_WEIGHT = 1e-12;

/**
 * Starts the field from the field of the next coarser level: each match doubles, plus the parity of the target. A match
 * that is not a valid source becomes a random valid source. Call it after the last vote of `coarse`: each target also
 * takes the vote weight of its parent, for `voteWeighted`.
 */
export function inheritMatches(field: Field, coarse: Field, random: () => number): void {
  const { level, valid, targets, match, dist } = field;
  const { width, height } = level;
  const cw = coarse.level.width;
  const cbox = coarse.box;
  for (let k = 0; k < targets.length; k++) {
    const t = targets[k];
    const x = t % width;
    const y = (t - x) / width;
    const px = (x >> 1) - cbox.x;
    const py = (y >> 1) - cbox.y;
    let result = -1;
    let weight = 0;
    if (px >= 0 && py >= 0 && px < cbox.w && py < cbox.h) {
      const cs = coarse.slot[py * cbox.w + px];
      const s = cs >= 0 ? coarse.match[cs] : -1;
      if (s >= 0) {
        const sx0 = s % cw;
        const sx = sx0 * 2 + (x & 1);
        const sy = ((s - sx0) / cw) * 2 + (y & 1);
        if (sx < width && sy < height && valid[sy * width + sx]) {
          result = sy * width + sx;
          weight = coarse.dist[cs];
        }
      }
    }
    match[k] = result >= 0 ? result : randomSource(field, random);
    // A random match only counts where no inherited match covers the pixel.
    dist[k] = result >= 0 ? weight : RANDOM_MATCH_WEIGHT;
  }
}

/** Recomputes the distance of each match, after a vote changed the hole pixels. */
export function refreshDistances(field: Field): void {
  const { level, radius, targets, match, dist } = field;
  for (let k = 0; k < targets.length; k++) dist[k] = matchCost(field, k, targets[k], match[k], Infinity);
}

/**
 * One PatchMatch pass: propagation from the previous neighbours in scan order (reversed on odd passes) and, when
 * `searchRadius` >= 1, a random search with a shrinking radius around the current match.
 */
export function improveMatches(field: Field, random: () => number, reverse: boolean, searchRadius: number, shrink: number): void {
  const { level, radius, valid, targets, match, dist, slot, box, textureWeight } = field;
  const { width, height } = level;
  const step = reverse ? -1 : 1;
  const n = targets.length;
  for (let j = 0; j < n; j++) {
    const k = reverse ? n - 1 - j : j;
    const t = targets[k];
    const tx = t % width;
    const ty = (t - tx) / width;
    let best = match[k];
    let bestDist = dist[k];

    const bx = tx - box.x;
    const by = ty - box.y;
    const nx = bx - step;
    if (nx >= 0 && nx < box.w) {
      const ns = slot[by * box.w + nx];
      if (ns >= 0) {
        const sx = (match[ns] % width) + step;
        const s = match[ns] + step;
        if (sx >= 0 && sx < width && valid[s] && s !== best) {
          const d = matchCost(field, k, t, s, bestDist);
          if (d < bestDist) {
            best = s;
            bestDist = d;
          }
        }
      }
    }
    const ny = by - step;
    if (ny >= 0 && ny < box.h) {
      const ns = slot[ny * box.w + bx];
      if (ns >= 0) {
        const s = match[ns] + step * width;
        if (s >= 0 && s < valid.length && valid[s] && s !== best) {
          const d = matchCost(field, k, t, s, bestDist);
          if (d < bestDist) {
            best = s;
            bestDist = d;
          }
        }
      }
    }

    for (let r = searchRadius; r >= 1; r *= shrink) {
      const cx0 = best % width;
      const cy0 = (best - cx0) / width;
      const cx = Math.min(width - 1, Math.max(0, cx0 + Math.round((random() * 2 - 1) * r)));
      const cy = Math.min(height - 1, Math.max(0, cy0 + Math.round((random() * 2 - 1) * r)));
      const s = cy * width + cx;
      if (!valid[s] || s === best) continue;
      const d = matchCost(field, k, t, s, bestDist);
      if (d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    match[k] = best;
    dist[k] = bestDist;
  }
}

/**
 * Each hole pixel becomes the weighted mean of the source pixels that the overlapping patches point to, with weight
 * exp(-d / (2 * sigma2)) and sigma2 = mean distance * `sigmaFactor`; a zero sigma2 gives equal weights. Writes the hole
 * pixels of `level.data` and replaces the distances with the weights, so refresh them before the next search.
 */
export function vote(field: Field, meanDist: number, sigmaFactor: number): void {
  const { level, radius, match, dist, slot, box } = field;
  const { data, width, hole, bounds } = level;
  const sigma2 = meanDist * sigmaFactor;
  const scale = sigma2 > 0 && Number.isFinite(sigma2) ? -1 / (2 * sigma2) : 0;
  for (let k = 0; k < dist.length; k++) {
    const d = dist[k];
    dist[k] = scale === 0 ? 1 : Number.isFinite(d) ? Math.exp(d * scale) : 0;
  }
  voteWeighted(field);
}

/** The vote of `vote`, with the weights already in `field.dist` (as `inheritMatches` leaves them). */
export function voteWeighted(field: Field): void {
  const { level, radius, match, dist, slot, box } = field;
  const { data, width, hole, bounds, texture } = level;
  const bx1 = box.x + box.w;
  const by1 = box.y + box.h;
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    const ty0 = Math.max(box.y, y - radius);
    const ty1 = Math.min(by1, y + radius + 1);
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const p = y * width + x;
      if (!hole[p]) continue;
      const tx0 = Math.max(box.x, x - radius);
      const tx1 = Math.min(bx1, x + radius + 1);
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let texX = 0;
      let texY = 0;
      let total = 0;
      for (let ty = ty0; ty < ty1; ty++) {
        let k = (ty - box.y) * box.w + tx0 - box.x;
        // The source pixel sits at the same offset from the match as p sits from the target.
        const rowOffset = (y - ty) * width;
        for (let tx = tx0; tx < tx1; tx++, k++) {
          const slotIndex = slot[k];
          if (slotIndex < 0) continue;
          const weight = dist[slotIndex];
          if (weight === 0) continue;
          const sp = match[slotIndex] + rowOffset + x - tx;
          const o = sp * 4;
          if (texture) {
            texX += texture[sp * 2] * weight;
            texY += texture[sp * 2 + 1] * weight;
          }
          r += data[o] * weight;
          g += data[o + 1] * weight;
          b += data[o + 2] * weight;
          a += data[o + 3] * weight;
          total += weight;
        }
      }
      if (total > 1e-30) {
        const o = p * 4;
        data[o] = Math.round(r / total);
        data[o + 1] = Math.round(g / total);
        data[o + 2] = Math.round(b / total);
        data[o + 3] = Math.round(a / total);
        if (texture) {
          texture[p * 2] = Math.round(texX / total);
          texture[p * 2 + 1] = Math.round(texY / total);
        }
      }
    }
  }
}
