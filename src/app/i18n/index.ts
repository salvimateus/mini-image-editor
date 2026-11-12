import * as adjust from './adjust.ts';
import * as chrome from './chrome.ts';
import * as core from './core.ts';
import * as doc from './doc.ts';
import * as exporting from './export.ts';
import * as geometry from './geometry.ts';
import * as paint from './paint.ts';
import * as select from './select.ts';
import * as stage from './stage.ts';
import * as text from './text.ts';

const ptBR = {
  ...core.ptBR,
  ...doc.ptBR,
  ...stage.ptBR,
  ...chrome.ptBR,
  ...paint.ptBR,
  ...select.ptBR,
  ...geometry.ptBR,
  ...adjust.ptBR,
  ...text.ptBR,
  ...exporting.ptBR,
};

export type TextKey = keyof typeof ptBR;

const en: Record<TextKey, string> = {
  ...core.en,
  ...doc.en,
  ...stage.en,
  ...chrome.en,
  ...paint.en,
  ...select.en,
  ...geometry.en,
  ...adjust.en,
  ...text.en,
  ...exporting.en,
};

export const locale: 'pt-BR' | 'en' =
  typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';

const table: Record<TextKey, string> = locale === 'pt-BR' ? ptBR : en;

export function t(key: TextKey, vars?: Record<string, string | number>): string {
  const text = table[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

const kbFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });

/** A file size in bytes, KB or MB, in the format of the UI language. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${kbFormat.format(bytes / 1024)} KB`;
  return `${kbFormat.format(bytes / (1024 * 1024))} MB`;
}

/** A number with exactly two decimals, in the format of the UI language. */
export function formatDecimal(value: number): string {
  return numberFormat.format(value);
}

const DECIMAL = /^[-+]?(\d+[.,]?\d*|[.,]\d+)$/;

/** A number typed by the user, with ',' or '.' as the decimal mark; null when the text is not a number. */
export function parseDecimal(text: string): number | null {
  const clean = text.trim();
  if (!DECIMAL.test(clean)) return null;
  const value = Number(clean.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}
