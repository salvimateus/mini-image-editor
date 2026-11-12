import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/inter/wght-italic.css';
import { readStored, writeStored } from '../storage.ts';
import { TUNING } from '../tuning/index.ts';

export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';
export const FONT_CATEGORIES: readonly FontCategory[] = ['sans-serif', 'serif', 'display', 'handwriting', 'monospace'];

/** One Google Fonts family: its upright and italic weights, and its popularity rank (1 = most used). */
export interface FontFamilyInfo {
  readonly family: string;
  readonly category: FontCategory;
  readonly weights: readonly number[];
  readonly italics: readonly number[];
  readonly rank: number;
}

export type FontStatus = 'ready' | 'offline';

/** The family that ships with the app and needs no network. */
export const BUNDLED_FAMILY = 'Inter';
/** The name of the bundled family in its @font-face rules. */
const BUNDLED_CSS_FAMILY = 'Inter Variable';
const ALL_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export const BUNDLED_INFO: FontFamilyInfo = { family: BUNDLED_FAMILY, category: 'sans-serif', weights: ALL_WEIGHTS, italics: ALL_WEIGHTS, rank: 0 };

const CSS_API = 'https://fonts.googleapis.com/css2';
const RECENT_KEY = 'text.recentFonts';
/** A sample with round, flat and tall letters, so `document.fonts.load` asks for the basic Latin subset. */
const SAMPLE = 'BESbswy';

// ----- catalog -----

let catalog: readonly FontFamilyInfo[] | null = null;
let byFamily = new Map<string, FontFamilyInfo>([[BUNDLED_FAMILY, BUNDLED_INFO]]);
let catalogPromise: Promise<readonly FontFamilyInfo[]> | null = null;

function isCategory(value: unknown): value is FontCategory {
  return typeof value === 'string' && (FONT_CATEGORIES as readonly string[]).includes(value);
}

function cleanWeights(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => Number.isInteger(entry) && entry >= 1 && entry <= 1000) : [];
}

function cleanCatalog(value: unknown): FontFamilyInfo[] {
  if (!Array.isArray(value)) return [];
  const out: FontFamilyInfo[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.family !== 'string' || !item.family) continue;
    const weights = cleanWeights(item.weights);
    const italics = cleanWeights(item.italics);
    if (!weights.length && !italics.length) continue;
    out.push({
      family: item.family,
      category: isCategory(item.category) ? item.category : 'display',
      weights,
      italics,
      rank: typeof item.rank === 'number' ? item.rank : out.length + 1,
    });
  }
  return out;
}

/** The catalog, sorted by popularity, loaded on first use. With no catalog chunk, only the bundled family. */
export function loadCatalog(): Promise<readonly FontFamilyInfo[]> {
  if (catalog) return Promise.resolve(catalog);
  catalogPromise ??= import('./catalog.json')
    .then((module) => {
      const list = cleanCatalog((module as { default: unknown }).default);
      // The bundled family stays in the list with the styles of the bundled file, so it never asks the network.
      const merged = [BUNDLED_INFO, ...list.filter((entry) => entry.family !== BUNDLED_FAMILY)].sort((a, b) => a.rank - b.rank);
      catalog = merged;
      byFamily = new Map(merged.map((entry) => [entry.family, entry]));
      return merged;
    })
    .catch(() => {
      catalogPromise = null;
      return [BUNDLED_INFO];
    });
  return catalogPromise;
}

/** The family info when the catalog is loaded (always for the bundled family), else null. */
export function familyInfo(family: string): FontFamilyInfo | null {
  return byFamily.get(family) ?? null;
}

/** The weight of the family nearest to `weight`, in the upright or the italic list; the request never asks for a missing weight. */
export function nearestWeight(info: FontFamilyInfo, weight: number, italic: boolean): number {
  const list = italic && info.italics.length ? info.italics : info.weights.length ? info.weights : info.italics;
  let best = list[0] ?? 400;
  for (const entry of list) if (Math.abs(entry - weight) < Math.abs(best - weight)) best = entry;
  return best;
}

/** True when the family has an italic at this weight. */
export function hasItalic(info: FontFamilyInfo, weight: number): boolean {
  return info.italics.includes(weight);
}

/** The weights that the weight menu offers: the upright ones, or the italic ones for an italic-only family. */
export function weightsOf(info: FontFamilyInfo, italic: boolean): readonly number[] {
  if (italic && info.italics.length) return info.italics;
  return info.weights.length ? info.weights : info.italics;
}

/** A style that the family has: the nearest weight, and italic only where it exists. */
export function fitStyle(info: FontFamilyInfo, weight: number, italic: boolean): { weight: number; italic: boolean } {
  const wantsItalic = italic && info.italics.length > 0;
  const fitted = nearestWeight(info, weight, wantsItalic);
  const onlyItalic = info.weights.length === 0;
  return { weight: fitted, italic: onlyItalic || (wantsItalic && hasItalic(info, fitted)) };
}

// ----- CSS names -----

/** The family name of the @font-face rules. */
export function cssFamily(family: string): string {
  return family === BUNDLED_FAMILY ? BUNDLED_CSS_FAMILY : family;
}

/** A quoted family name for `ctx.font` and CSS. */
export function quoteFamily(family: string): string {
  return `"${cssFamily(family).replace(/["\\]/g, '')}"`;
}

/** The CSS font-family value of a picker row or a preview: the family, then the UI font. */
export function familyStack(family: string): string {
  return `${quoteFamily(family)}, var(--font-body)`;
}

/** A CSS font shorthand: 'italic 700 16px "Family"'. */
export function fontShorthand(family: string, weight: number, italic: boolean, size: number): string {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${quoteFamily(family)}`;
}

function encodeFamily(family: string): string {
  return encodeURIComponent(family).replace(/%20/g, '+');
}

function styleQuery(family: string, weight: number, italic: boolean): string {
  return `family=${encodeFamily(family)}:ital,wght@${italic ? 1 : 0},${weight}`;
}

// ----- loading -----

function styleKey(family: string, weight: number, italic: boolean): string {
  return `${family}|${weight}|${italic ? 1 : 0}`;
}

function timeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** One stylesheet link; resolves false on an error or a time-out, and then removes the link so a later try starts clean. */
function addStylesheet(href: string): { link: HTMLLinkElement; done: Promise<boolean> } {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  const done = new Promise<boolean>((resolve) => {
    link.addEventListener('load', () => resolve(true), { once: true });
    link.addEventListener('error', () => resolve(false), { once: true });
  });
  document.head.append(link);
  return {
    link,
    done: timeout(done, TUNING.text.fontTimeoutMs, false).then((ok) => {
      if (!ok) link.remove();
      return ok;
    }),
  };
}

/** The stylesheet of each full style: one link each, kept for the session. */
const sheets = new Map<string, Promise<boolean>>();
/** The time of the last failure of a style, so an offline app does not ask again on each key press. */
const failedAt = new Map<string, number>();
/** Styles whose faces are loaded. */
const ready = new Set<string>();
/** Families with at least one full style asked for; their picker rows need no preview. */
const fullFamilies = new Set<string>();

function stylesheet(family: string, weight: number, italic: boolean): Promise<boolean> {
  const key = styleKey(family, weight, italic);
  let sheet = sheets.get(key);
  if (!sheet) {
    sheet = addStylesheet(`${CSS_API}?${styleQuery(family, weight, italic)}&display=swap`).done.then((ok) => {
      if (!ok) sheets.delete(key);
      return ok;
    });
    sheets.set(key, sheet);
  }
  return sheet;
}

async function loadFaces(shorthand: string, text: string): Promise<boolean> {
  const fonts = document.fonts;
  const basic = timeout(fonts.load(shorthand, SAMPLE), TUNING.text.fontTimeoutMs, [] as FontFace[]);
  // The glyphs of the text can live in other unicode-range subsets (Latin Extended, Cyrillic, Greek).
  const extra = text ? timeout(fonts.load(shorthand, text), TUNING.text.fontTimeoutMs, [] as FontFace[]) : Promise.resolve([]);
  const [faces] = await Promise.all([basic, extra]);
  return faces.length > 0;
}

/**
 * Loads one style of a family for the canvas: a stylesheet link to the Google Fonts CSS API (the bundled family needs
 * none), then `document.fonts.load` with a time limit. 'offline' when the style does not load; the caller then uses the
 * bundled family. `text` makes sure that the subsets of its glyphs are loaded too.
 */
export async function loadFont(family: string, weight: number, italic: boolean, text = ''): Promise<FontStatus> {
  if (typeof document === 'undefined' || !document.fonts) return 'offline';
  const info = family === BUNDLED_FAMILY ? BUNDLED_INFO : (familyInfo(family) ?? (await loadCatalog(), familyInfo(family)));
  const style = info ? fitStyle(info, weight, italic) : { weight, italic };
  const key = styleKey(family, style.weight, style.italic);
  const shorthand = fontShorthand(family, style.weight, style.italic, 32);
  if (family !== BUNDLED_FAMILY) {
    if (!info) return 'offline';
    const failed = failedAt.get(key);
    if (failed !== undefined && performance.now() - failed < TUNING.text.offlineRetryMs) return 'offline';
    removePreview(family);
    fullFamilies.add(family);
    if (!(await stylesheet(family, style.weight, style.italic))) {
      failedAt.set(key, performance.now());
      return 'offline';
    }
  }
  if (ready.has(key) && (!text || document.fonts.check(shorthand, text))) return 'ready';
  if (!(await loadFaces(shorthand, text))) {
    failedAt.set(key, performance.now());
    return 'offline';
  }
  failedAt.delete(key);
  ready.add(key);
  return 'ready';
}

/** Forgets the failures of a family, so the next load asks the network again at once. */
export function retryFont(family: string): void {
  for (const key of [...failedAt.keys()]) if (key.startsWith(`${family}|`)) failedAt.delete(key);
}

/** True when the style is loaded with the glyphs of `text`, so a render can run now, with no wait. */
export function fontReady(family: string, weight: number, italic: boolean, text = ''): boolean {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const info = familyInfo(family);
  const style = info ? fitStyle(info, weight, italic) : { weight, italic };
  if (!ready.has(styleKey(family, style.weight, style.italic))) return false;
  return !text || document.fonts.check(fontShorthand(family, style.weight, style.italic, 32), text);
}

// ----- picker previews -----

/** The style that a picker row shows: the weight nearest to 400, upright when the family has an upright. */
export function previewStyle(info: FontFamilyInfo): { weight: number; italic: boolean } {
  return fitStyle(info, 400, false);
}

const previews = new Map<string, HTMLLinkElement>();
const previewQueue: FontFamilyInfo[] = [];
let previewTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * A preview face holds only the glyphs of the family name (`&text=`) and claims every character, so it goes away
 * before the full style of the family loads: the canvas must never draw with it.
 */
function removePreview(family: string): void {
  previews.get(family)?.remove();
  previews.delete(family);
}

function flushPreviews(): void {
  previewTimer = null;
  const batch = previewQueue.splice(0, TUNING.text.previewBatchSize);
  for (const info of batch) {
    if (previews.has(info.family) || fullFamilies.has(info.family)) continue;
    const { weight, italic } = previewStyle(info);
    const href = `${CSS_API}?${styleQuery(info.family, weight, italic)}&text=${encodeURIComponent(info.family)}&display=swap`;
    const { link, done } = addStylesheet(href);
    previews.set(info.family, link);
    void done.then((ok) => {
      if (!ok && previews.get(info.family) === link) previews.delete(info.family);
    });
  }
  if (previewQueue.length) previewTimer = setTimeout(flushPreviews, TUNING.text.previewBatchMs);
}

/** Asks for a small face with only the letters of the family name, for its picker row. Requests go out in small batches. */
export function previewFont(info: FontFamilyInfo): void {
  if (typeof document === 'undefined' || info.family === BUNDLED_FAMILY) return;
  if (previews.has(info.family) || fullFamilies.has(info.family)) return;
  if (previewQueue.some((entry) => entry.family === info.family)) return;
  previewQueue.push(info);
  previewTimer ??= setTimeout(flushPreviews, TUNING.text.previewBatchMs);
}

/** Drops the queued previews that are no longer in view. */
export function cancelPreviews(keep: ReadonlySet<string>): void {
  for (let i = previewQueue.length - 1; i >= 0; i--) if (!keep.has(previewQueue[i].family)) previewQueue.splice(i, 1);
}

// ----- recent families -----

export function recentFamilies(): string[] {
  const text = readStored(RECENT_KEY);
  if (!text) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0).slice(0, TUNING.text.recentMax) : [];
  } catch {
    return [];
  }
}

/** Puts the family first in the recent list. */
export function rememberFamily(family: string): string[] {
  const next = [family, ...recentFamilies().filter((entry) => entry !== family)].slice(0, TUNING.text.recentMax);
  writeStored(RECENT_KEY, JSON.stringify(next));
  return next;
}
