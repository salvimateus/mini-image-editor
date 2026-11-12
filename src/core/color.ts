import type { Rgba } from './types.ts';

function clampByte(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}

function hexByte(value: number): string {
  return clampByte(value).toString(16).padStart(2, '0');
}

/** '#rrggbb', lowercase. The alpha is ignored. */
export function toHex(color: Rgba): string {
  return `#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}`;
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Accepts '#rgb' and '#rrggbb', with or without '#'. Returns null when the text is not a color. The alpha is 255. */
export function fromHex(text: string): Rgba | null {
  const match = HEX_PATTERN.exec(text.trim());
  if (!match) return null;
  let digits = match[1];
  if (digits.length === 3) digits = digits[0] + digits[0] + digits[1] + digits[1] + digits[2] + digits[2];
  const value = Number.parseInt(digits, 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff, a: 255 };
}

/** h in degrees 0..360, s and v 0..1. */
export function rgbToHsv(color: Rgba): { h: number; s: number; v: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

/** h in degrees (any value, wraps), s and v 0..1, a 0..255. */
export function hsvToRgb(h: number, s: number, v: number, a = 255): Rgba {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, s));
  const val = Math.min(1, Math.max(0, v));
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: clampByte((r + m) * 255), g: clampByte((g + m) * 255), b: clampByte((b + m) * 255), a: clampByte(a) };
}

export function toCss(color: Rgba): string {
  const a = clampByte(color.a);
  if (a === 255) return `rgb(${clampByte(color.r)} ${clampByte(color.g)} ${clampByte(color.b)})`;
  return `rgb(${clampByte(color.r)} ${clampByte(color.g)} ${clampByte(color.b)} / ${(a / 255).toFixed(3)})`;
}

export function sameColor(a: Rgba, b: Rgba): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

export const TRANSPARENT: Rgba = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
export const WHITE: Rgba = Object.freeze({ r: 255, g: 255, b: 255, a: 255 });
export const BLACK: Rgba = Object.freeze({ r: 0, g: 0, b: 0, a: 255 });
