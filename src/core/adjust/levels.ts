import { PARAMS } from '../params/index.ts';
import type { LevelsParams, RasterImage } from '../types.ts';
import { clamp, rowProgress } from './common.ts';

export const LEVELS_IDENTITY: LevelsParams = Object.freeze({ channel: 'rgb', inBlack: 0, gamma: 1, inWhite: 255, outBlack: 0, outWhite: 255 });

export function isLevelsIdentity(params: LevelsParams): boolean {
  return params.inBlack === 0 && params.gamma === 1 && params.inWhite === 255 && params.outBlack === 0 && params.outWhite === 255;
}

/** The params inside their ranges: input points apart by at least the minimum span, gamma in its range. */
export function cleanLevels(params: LevelsParams): LevelsParams {
  const { gammaMin, gammaMax, minInputSpan } = PARAMS.adjust.levels;
  const inBlack = Math.round(clamp(params.inBlack, 0, 255 - minInputSpan));
  const inWhite = Math.round(clamp(params.inWhite, inBlack + minInputSpan, 255));
  return {
    channel: params.channel,
    inBlack,
    gamma: clamp(Number.isFinite(params.gamma) ? params.gamma : 1, gammaMin, gammaMax),
    inWhite,
    outBlack: Math.round(clamp(params.outBlack, 0, 255)),
    outWhite: Math.round(clamp(params.outWhite, 0, 255)),
  };
}

/** The 256-entry table of the levels curve: input black, gamma and white, then the output range. */
export function levelsTable(params: LevelsParams): Uint8ClampedArray {
  const p = cleanLevels(params);
  const table = new Uint8ClampedArray(256);
  const span = p.inWhite - p.inBlack;
  const exponent = 1 / p.gamma;
  for (let v = 0; v < 256; v++) {
    const x = clamp((v - p.inBlack) / span, 0, 1);
    table[v] = p.outBlack + Math.pow(x, exponent) * (p.outWhite - p.outBlack);
  }
  return table;
}

/** Input position (0..255) of the gray handle: the input value that the curve maps to the middle of the output. */
export function gammaHandle(params: LevelsParams): number {
  const p = cleanLevels(params);
  return p.inBlack + (p.inWhite - p.inBlack) * Math.pow(0.5, p.gamma);
}

/** The gamma that puts the gray handle at `position` (0..255) between the input points. */
export function gammaFromHandle(params: LevelsParams, position: number): number {
  const { gammaMin, gammaMax } = PARAMS.adjust.levels;
  const p = cleanLevels(params);
  const x = clamp((position - p.inBlack) / (p.inWhite - p.inBlack), 1e-4, 1 - 1e-4);
  return clamp(Math.log(x) / Math.log(0.5), gammaMin, gammaMax);
}

export function applyLevels(src: RasterImage, params: LevelsParams, onProgress?: (ratio: number) => void): RasterImage {
  const table = levelsTable(params);
  const { width, height } = src;
  const s = src.data;
  const d = s.slice();
  const tick = rowProgress(height, onProgress);
  const all = params.channel === 'rgb';
  const only = params.channel === 'r' ? 0 : params.channel === 'g' ? 1 : 2;
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    tick(y);
    const end = (y + 1) * rowBytes;
    if (all) {
      for (let i = y * rowBytes; i < end; i += 4) {
        d[i] = table[s[i]];
        d[i + 1] = table[s[i + 1]];
        d[i + 2] = table[s[i + 2]];
      }
    } else {
      for (let i = y * rowBytes + only; i < end; i += 4) d[i] = table[s[i]];
    }
  }
  return { width, height, data: d };
}
