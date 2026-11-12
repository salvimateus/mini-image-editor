import { refreshStageColors } from '../ui/stage-renderer.ts';
import type { TextKey } from './i18n/index.ts';
import { readStored, writeStored } from './storage.ts';

export type ThemeId = 'musgo' | 'menta' | 'grafite' | 'papel' | 'neon' | 'sorvete';

export interface ThemeInfo {
  id: ThemeId;
  label: TextKey;
  kind: 'dark' | 'light';
  /** Background, raised surface, accent and text: a small preview for the picker. */
  swatches: readonly [string, string, string, string];
}

/** The order of the picker. The swatches repeat the main tokens of each block in tokens.css and themes.css. */
export const THEMES: readonly ThemeInfo[] = [
  { id: 'musgo', label: 'theme.musgo', kind: 'dark', swatches: ['#202734', '#36415a', '#b7d894', '#e0f8c7'] },
  { id: 'menta', label: 'theme.menta', kind: 'light', swatches: ['oklch(0.96 0.035 129)', 'oklch(0.91 0.05 129)', 'oklch(0.42 0.1 140)', '#202734'] },
  { id: 'grafite', label: 'theme.grafite', kind: 'dark', swatches: ['oklch(0.245 0.004 260)', 'oklch(0.35 0.007 260)', 'oklch(0.8 0.075 240)', 'oklch(0.96 0.003 260)'] },
  { id: 'papel', label: 'theme.papel', kind: 'light', swatches: ['oklch(0.97 0.008 85)', 'oklch(0.925 0.011 85)', 'oklch(0.43 0.11 255)', 'oklch(0.24 0.015 260)'] },
  { id: 'neon', label: 'theme.neon', kind: 'dark', swatches: ['oklch(0.2 0.035 285)', 'oklch(0.79 0.18 345)', 'oklch(0.86 0.13 200)', 'oklch(0.91 0.16 100)'] },
  { id: 'sorvete', label: 'theme.sorvete', kind: 'light', swatches: ['oklch(0.965 0.022 345)', 'oklch(0.92 0.038 300)', 'oklch(0.47 0.19 355)', 'oklch(0.8 0.13 165)'] },
];

export const DEFAULT_THEME: ThemeId = 'musgo';

/** Also read by public/theme-init.js before the first paint, with the same storage prefix. */
const STORAGE_KEY = 'theme';
/** How long the colors cross-fade after a pick; the class only exists for that time. */
const SHIFT_MS = 320;
const SHIFT_CLASS = 'theme-shift';

export const theme = $state<{ current: ThemeId }>({ current: DEFAULT_THEME });

type ThemeListener = (id: ThemeId) => void;
const listeners = new Set<ThemeListener>();
let shiftTimer = 0;

function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((entry) => entry.id === value);
}

export function themeInfo(id: ThemeId): ThemeInfo {
  return THEMES.find((entry) => entry.id === id) ?? THEMES[0];
}

/**
 * Runs `listener` after each theme change, when the tokens and STAGE_COLORS already hold the new colors.
 * Canvas code that keeps a color or a sprite uses this to redraw. Returns the unsubscribe function.
 */
export function onThemeChange(listener: ThemeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function apply(id: ThemeId): void {
  const root = document.documentElement;
  root.dataset.theme = id;
  refreshStageColors();
  for (const listener of listeners) listener(id);
}

/** Applies the stored theme before the first render. A stored id that no longer exists gives the default. */
export function initTheme(): void {
  const stored = readStored(STORAGE_KEY);
  const id = isThemeId(stored) ? stored : DEFAULT_THEME;
  theme.current = id;
  apply(id);
}

/** Applies and stores a theme, with a short color cross-fade unless the user asks for reduced motion. */
export function setTheme(id: ThemeId): void {
  if (!isThemeId(id)) return;
  const changed = id !== theme.current;
  theme.current = id;
  writeStored(STORAGE_KEY, id);
  if (!changed) return;
  const root = document.documentElement;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add(SHIFT_CLASS);
    window.clearTimeout(shiftTimer);
    shiftTimer = window.setTimeout(() => root.classList.remove(SHIFT_CLASS), SHIFT_MS);
  }
  apply(id);
}
