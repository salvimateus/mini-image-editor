import * as adjust from './adjust.ts';
import * as chrome from './chrome.ts';
import * as core from './core.ts';
import * as doc from './doc.ts';
import * as exporting from './export.ts';
import * as geometry from './geometry.ts';
import * as languageText from './language.ts';
import { language, type Locale } from './language.svelte.ts';
import * as paint from './paint.ts';
import * as select from './select.ts';
import * as stage from './stage.ts';
import * as shapes from './shapes.ts';
import * as text from './text.ts';
import * as theme from './theme.ts';

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
  ...shapes.ptBR,
  ...exporting.ptBR,
  ...theme.ptBR,
  ...languageText.ptBR,
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
  ...shapes.en,
  ...exporting.en,
  ...theme.en,
  ...languageText.en,
};

export type { Locale };

/**
 * The UI locale now. It is reactive: a template, `$derived` or `$effect` that reads it, or reads `t`
 * and the format functions, updates after a language change. A value kept outside them does not.
 */
export function getLocale(): Locale {
  return language.locale;
}

export function t(key: TextKey, vars?: Record<string, string | number>): string {
  const text = (language.locale === 'pt-BR' ? ptBR : en)[key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

let formatsLocale: Locale | null = null;
let numberFormat: Intl.NumberFormat;
let kbFormat: Intl.NumberFormat;

/** The formats are made again only when the locale changes. */
function formats(): { numberFormat: Intl.NumberFormat; kbFormat: Intl.NumberFormat } {
  const current = language.locale;
  if (current !== formatsLocale) {
    formatsLocale = current;
    numberFormat = new Intl.NumberFormat(current, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    kbFormat = new Intl.NumberFormat(current, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  }
  return { numberFormat, kbFormat };
}

/** A file size in bytes, KB or MB, in the format of the UI language. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const { kbFormat } = formats();
  if (bytes < 1024 * 1024) return `${kbFormat.format(bytes / 1024)} KB`;
  return `${kbFormat.format(bytes / (1024 * 1024))} MB`;
}

/** A number with exactly two decimals, in the format of the UI language. */
export function formatDecimal(value: number): string {
  return formats().numberFormat.format(value);
}

const DECIMAL = /^[-+]?(\d+[.,]?\d*|[.,]\d+)$/;

/** A number typed by the user, with ',' or '.' as the decimal mark; null when the text is not a number. */
export function parseDecimal(text: string): number | null {
  const clean = text.trim();
  if (!DECIMAL.test(clean)) return null;
  const value = Number(clean.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}
