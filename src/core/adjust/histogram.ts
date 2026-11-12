import { PARAMS } from '../params/index.ts';
import type { Histogram, LevelsParams, RasterImage } from '../types.ts';
import { luma } from './common.ts';
import { LEVELS_IDENTITY } from './levels.ts';

/** 256 bins for R, G, B and luma. Only pixels with alpha > 0 and with coverage > 0 count. */
export function histogram(src: RasterImage, cover: Uint8Array | null): Histogram {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const y = new Uint32Array(256);
  const s = src.data;
  for (let p = 0, i = 0; i < s.length; p++, i += 4) {
    if (s[i + 3] === 0 || (cover && cover[p] === 0)) continue;
    r[s[i]]++;
    g[s[i + 1]]++;
    b[s[i + 2]]++;
    y[Math.round(luma(s[i], s[i + 1], s[i + 2]))]++;
  }
  return { r, g, b, luma: y };
}

/**
 * Levels that stretch the luma: PARAMS.adjust.levels.autoClip of the counted pixels is clipped at each end. The same
 * points go on R, G and B together, so the colors do not shift. An empty or flat histogram gives the identity.
 */
export function autoLevels(hist: Histogram): LevelsParams {
  const bins = hist.luma;
  let total = 0;
  for (let i = 0; i < 256; i++) total += bins[i];
  if (total === 0) return { ...LEVELS_IDENTITY };
  const clip = total * PARAMS.adjust.levels.autoClip;
  let low = 0;
  let seen = 0;
  while (low < 255 && seen + bins[low] <= clip) seen += bins[low++];
  let high = 255;
  seen = 0;
  while (high > 0 && seen + bins[high] <= clip) seen += bins[high--];
  if (high - low < PARAMS.adjust.levels.minInputSpan) return { ...LEVELS_IDENTITY };
  return { channel: 'rgb', inBlack: low, gamma: 1, inWhite: high, outBlack: 0, outWhite: 255 };
}
