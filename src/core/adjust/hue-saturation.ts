import { PARAMS } from '../params/index.ts';
import type { HueSaturationParams, RasterImage } from '../types.ts';
import { clamp, clamp255, luma, rowProgress } from './common.ts';

export const HUE_SATURATION_IDENTITY: HueSaturationParams = Object.freeze({ hue: 0, saturation: 0, lightness: 0, colorize: false });

export function isHueSaturationIdentity(params: HueSaturationParams): boolean {
  return !params.colorize && params.hue === 0 && params.saturation === 0 && params.lightness === 0;
}

/** One color through the filter: (r, g, b) 0..255 in, the result written to out[0..2]. */
export type ColorMap = (r: number, g: number, b: number, out: Float64Array) => void;

/** HSL (h in degrees, s and l 0..1) to RGB 0..255 in out[0..2]. */
function hslToRgb(h: number, s: number, l: number, out: Float64Array): void {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = c;
  let g = 0;
  let b = x;
  if (hp < 1) {
    g = x;
    b = 0;
  } else if (hp < 2) {
    r = x;
    g = c;
    b = 0;
  } else if (hp < 3) {
    r = 0;
    g = c;
  } else if (hp < 4) {
    r = 0;
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  }
  const m = l - c / 2;
  out[0] = (r + m) * 255;
  out[1] = (g + m) * 255;
  out[2] = (b + m) * 255;
}

/**
 * The Master range of the Photoshop Hue/Saturation: hue rotates in HSL, saturation scales the HSL saturation (gray
 * stays gray), lightness blends toward black or white. Colorize puts one hue and one saturation on the luminance.
 */
export function hueSaturationMap(params: HueSaturationParams): ColorMap {
  const { maxBoostDivisor, colorizeBase } = PARAMS.adjust.hueSaturation;
  const hue = clamp(params.hue, -180, 180);
  const sat = clamp(params.saturation, -100, 100) / 100;
  const light = clamp(params.lightness, -100, 100) / 100;
  const lighten = (out: Float64Array) => {
    if (light < 0) {
      const k = 1 + light;
      out[0] *= k;
      out[1] *= k;
      out[2] *= k;
    } else if (light > 0) {
      out[0] += (255 - out[0]) * light;
      out[1] += (255 - out[1]) * light;
      out[2] += (255 - out[2]) * light;
    }
  };
  if (params.colorize) {
    const h = (hue + 360) % 360;
    const s = sat < 0 ? colorizeBase * (1 + sat) : colorizeBase + (1 - colorizeBase) * sat;
    return (r, g, b, out) => {
      hslToRgb(h, s, luma(r, g, b) / 255, out);
      lighten(out);
    };
  }
  const boost = sat > 0 ? 1 / (1 - sat * (1 - maxBoostDivisor)) : 1 + sat;
  return (r, g, b, out) => {
    const rf = r / 255;
    const gf = g / 255;
    const bf = b / 255;
    const max = Math.max(rf, gf, bf);
    const min = Math.min(rf, gf, bf);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) {
      out[0] = r;
      out[1] = g;
      out[2] = b;
    } else {
      let h: number;
      if (max === rf) h = ((gf - bf) / d) % 6;
      else if (max === gf) h = (bf - rf) / d + 2;
      else h = (rf - gf) / d + 4;
      const s = d / (1 - Math.abs(2 * l - 1));
      hslToRgb(h * 60 + hue, Math.min(1, s * boost), l, out);
    }
    lighten(out);
  };
}

export function applyHueSaturation(src: RasterImage, params: HueSaturationParams, onProgress?: (ratio: number) => void): RasterImage {
  const map = hueSaturationMap(params);
  const { width, height } = src;
  const s = src.data;
  const d = new Uint8ClampedArray(s.length);
  const out = new Float64Array(3);
  const tick = rowProgress(height, onProgress);
  let i = 0;
  for (let y = 0; y < height; y++) {
    tick(y);
    for (let x = 0; x < width; x++, i += 4) {
      if (s[i + 3] === 0) {
        d[i] = s[i];
        d[i + 1] = s[i + 1];
        d[i + 2] = s[i + 2];
        continue;
      }
      map(s[i], s[i + 1], s[i + 2], out);
      d[i] = clamp255(out[0]);
      d[i + 1] = clamp255(out[1]);
      d[i + 2] = clamp255(out[2]);
    }
  }
  return { width, height, data: d };
}
