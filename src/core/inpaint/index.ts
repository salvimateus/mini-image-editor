import { PARAMS } from '../params/index.ts';
import type { RasterImage, Rect } from '../types.ts';
import { createField, createRandom, improveMatches, inheritMatches, randomMatches, sourceMap, structureFill, refreshDistances, vote, voteWeighted, type Field } from './patch-match.ts';
import { computeTexture, holeBounds, holeInradius, premultiply, reduceLevel, sampleBilinear, type Level } from './pyramid.ts';
import { matchBorder } from './seam.ts';

export interface InpaintResult {
  /** The blended pixels of `rect`, straight-alpha RGBA8. */
  image: RasterImage;
  /** The bounds of the hole, in px of the input image. */
  rect: Rect;
}

export interface InpaintOptions {
  /** Called after each EM pass, ratio 0..1. */
  onProgress?(ratio: number): void;
}

/** The source area of a hole: the hole rect grown by a margin, inside the image. All values in image px. */
export function inpaintContext(hole: Rect, width: number, height: number): Rect {
  const P = PARAMS.inpaint;
  const x0 = Math.floor(hole.x);
  const y0 = Math.floor(hole.y);
  const w = Math.max(0, Math.ceil(hole.x + hole.w) - x0);
  const h = Math.max(0, Math.ceil(hole.y + hole.h) - y0);
  let margin = Math.max(P.minContextPx, Math.round(Math.max(w, h) * P.contextRatio));
  // The largest m with (w + 2m) * (h + 2m) <= maxContextPixels.
  const b = 2 * (w + h);
  const c = w * h - P.maxContextPixels;
  const fit = Math.floor((-b + Math.sqrt(b * b - 16 * c)) / 8);
  margin = Math.max(P.minContextPx, Math.min(margin, fit));
  const left = Math.max(0, x0 - margin);
  const top = Math.max(0, y0 - margin);
  const right = Math.min(width, x0 + w + margin);
  const bottom = Math.min(height, y0 + h + margin);
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

/**
 * Fills the hole of `image` with patches from the rest of the image (PatchMatch over a coarse-to-fine pyramid), then
 * blends the fill by the hole coverage times `strength` (0..1). `hole` holds one coverage value 0..255 for each pixel.
 * Returns only the pixels of the hole bounds, or null when there is no hole pixel or no patch can be a source. The
 * result is deterministic, and the input is never changed. Only an image above `maxContextPixels` (a hole too large
 * for any context) works at a reduced scale, with a softer result.
 */
export function inpaint(image: RasterImage, hole: Uint8Array, strength: number, options: InpaintOptions = {}): InpaintResult | null {
  const P = PARAMS.inpaint;
  const { width, height } = image;
  const flags = new Uint8Array(width * height);
  for (let i = 0; i < flags.length; i++) flags[i] = hole[i] >= P.holeMinCoverage ? 1 : 0;
  const rect = holeBounds(flags, width, height);
  if (!rect) return null;

  const pixels = width * height;
  const scale = pixels > P.maxContextPixels ? Math.ceil(Math.sqrt(pixels / P.maxContextPixels)) : 1;
  const base: Level =
    scale > 1
      ? reduceLevel({ width, height, data: image.data, hole: flags, bounds: rect }, scale, true)
      : { width, height, data: premultiply(image.data), hole: flags, bounds: rect, texture: null };
  if (!fill(base, options.onProgress)) return null;
  if (P.seam.cellPx > 0) matchBorder(base, P.seam);

  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  const src = image.data;
  const fullAt = 1 / (255 * P.blendFullCoverage);
  const amount = Math.min(1, Math.max(0, strength));
  const px = new Float32Array(4);
  for (let y = rect.y, v = 0; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++, v++) {
      const i = y * width + x;
      const o = i * 4;
      const vo = v * 4;
      const weight = flags[i] ? Math.min(1, hole[i] * fullAt) * amount : 0;
      if (!(weight > 0)) {
        out[vo] = src[o];
        out[vo + 1] = src[o + 1];
        out[vo + 2] = src[o + 2];
        out[vo + 3] = src[o + 3];
        continue;
      }
      if (scale > 1) sampleBilinear(base, (x + 0.5) / scale - 0.5, (y + 0.5) / scale - 0.5, px);
      else for (let c = 0; c < 4; c++) px[c] = base.data[o + c];
      const a0 = src[o + 3];
      const alpha = a0 + (px[3] - a0) * weight;
      if (alpha < 0.5) continue;
      const unit = a0 / 255;
      for (let c = 0; c < 3; c++) {
        const before = src[o + c] * unit;
        out[vo + c] = Math.round(((before + (px[c] - before) * weight) * 255) / alpha);
      }
      out[vo + 3] = Math.round(alpha);
    }
  }
  return { image: { width: rect.w, height: rect.h, data: out }, rect };
}

/**
 * Runs the pyramid on a level and fills its hole in place. The levels up to `maxWorkPixels` get the full search; each
 * finer level only inherits the match field, refines it by propagation and votes, so the result keeps real texture at
 * full resolution. False when no level has a source patch.
 */
function fill(base: Level, onProgress: ((ratio: number) => void) | undefined): boolean {
  const P = PARAMS.inpaint;
  const radius = P.patchRadius;
  const random = createRandom(P.seed);
  const sideAt = (l: number): [number, number] => [Math.ceil(base.width / 2 ** l), Math.ceil(base.height / 2 ** l)];
  const pixelsAt = (l: number): number => sideAt(l)[0] * sideAt(l)[1];

  let work = 0;
  while (pixelsAt(work) > P.maxWorkPixels) work++;
  const inradius = holeInradius(base);
  let top = inradius > P.coarseHoleRadiusPx ? Math.ceil(Math.log2(Math.min(inradius, 1 << 20) / P.coarseHoleRadiusPx)) : 0;
  top = Math.max(top, work);
  while (top > work && Math.min(...sideAt(top)) < P.minLevelPx) top--;
  const levels: Level[] = [base];
  // The fine levels compare colors only: their colors still hold the texture, and the check costs most there.
  const textureLevel = Math.max(P.texture.level, work);
  for (let l = 1; l <= top; l++) {
    levels.push(reduceLevel(levels[l - 1], 2));
    if (l === textureLevel) computeTexture(levels[l], P.texture.radius, P.texture.gain);
  }

  // A level finer than `work` cannot start the search: it has no source list, and its field is too large.
  while (top >= work && !sourceMap(levels[top], radius, false).validCount) top--;
  if (top < work) return false;
  let field: Field = createField(levels[top], radius, pixelsAt(top) <= P.maxWorkPixels, P.texture.weight, P.knownWeight);

  const span = Math.max(1, top - work);
  const iterationsAt = (l: number): number => {
    if (l === top) return P.iterations.coarse;
    if (l < work) return P.refineIterations;
    return Math.round(P.iterations.fine + ((P.iterations.coarse - P.iterations.fine) * (l - work)) / span);
  };
  const passesAt = (l: number): number => iterationsAt(l) + (l === top ? 0 : 1);
  const workAt = (l: number): number => {
    const b = levels[l].bounds;
    return (b.w + 2 * radius) * (b.h + 2 * radius) * passesAt(l);
  };
  let total = 0;
  for (let l = 0; l <= top; l++) total += workAt(l);
  let done = 0;
  const pass = (l: number): void => {
    done += workAt(l) / passesAt(l);
    onProgress?.(Math.min(1, done / total));
  };

  for (let l = top; l >= 0; l--) {
    const level = levels[l];
    if (l < top) {
      const coarse: Field = field;
      // Inheritance reads only the matches and weights of the coarser field.
      coarse.validList = null;
      field = createField(level, radius, pixelsAt(l) <= P.maxWorkPixels, P.texture.weight, P.knownWeight);
      inheritMatches(field, coarse, random);
    } else {
      randomMatches(field, random);
      structureFill(field, random, { radius: P.fillPatchRadius, samples: P.fillSamples, localSamples: P.fillLocalSamples, localPx: P.fillLocalPx, exhaustiveBudget: P.fillExhaustiveBudget, shrink: P.searchShrink, dataFloor: P.fillDataFloor });
      // Equal weights, for an inheritance with no EM iteration at this level.
      field.dist.fill(1);
    }
    const iterations = iterationsAt(l);
    const longest = Math.max(level.width, level.height);
    let searchRadius = l === top ? longest : l < work ? 0 : Math.min(P.fineSearchPx, longest);
    if (field.targets.length > P.searchMaxTargets) searchRadius = 0;
    const levelSigma = P.voteSigma.fine + (P.voteSigma.coarse - P.voteSigma.fine) * Math.min(1, l / P.voteSigma.levels);
    const sigmaOf = (last: boolean): number => (l === 0 && last ? P.finalSigma : levelSigma);
    if (l < top) {
      // The hole pixels of a new level have no value yet, so the first vote uses the weights of the coarser level.
      voteWeighted(field);
      pass(l);
    }
    for (let i = 0; i < iterations; i++) {
      refreshDistances(field);
      improveMatches(field, random, i % 2 === 1, searchRadius, P.searchShrink);
      vote(field, meanOf(field.dist), sigmaOf(i === iterations - 1));
      pass(l);
    }
    // The coarser levels are no longer read; free them before the next, larger level.
    levels.length = l + 1;
  }
  return true;
}

function meanOf(values: Float32Array): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return values.length ? total / values.length : 0;
}
