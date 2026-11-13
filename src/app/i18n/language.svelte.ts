import { readStored, writeStored } from '../storage.ts';

export type Locale = 'pt-BR' | 'en';
/** 'auto' follows the language of the system. */
export type LanguageId = 'auto' | Locale;

export const DEFAULT_LANGUAGE: LanguageId = 'auto';

const STORAGE_KEY = 'language';

function systemLocale(): Locale {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

function resolve(id: LanguageId): Locale {
  return id === 'auto' ? systemLocale() : id;
}

export function isLanguageId(value: string | null): value is LanguageId {
  return value === 'auto' || value === 'pt-BR' || value === 'en';
}

/** The choice of the user and the locale it gives. `t` and the number formats read `locale`, so the UI follows a change with no reload. */
export const language = $state<{ choice: LanguageId; locale: Locale }>({ choice: DEFAULT_LANGUAGE, locale: systemLocale() });

type LanguageListener = (locale: Locale) => void;
const listeners = new Set<LanguageListener>();
let systemWatched = false;

/**
 * Runs `listener` after each change of the UI locale, when `t` already gives the new text.
 * Code outside the reactive graph that keeps a string (a canvas sprite, a DOM label) uses this to draw again.
 */
export function onLanguageChange(listener: LanguageListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function apply(): void {
  const next = resolve(language.choice);
  const changed = next !== language.locale;
  language.locale = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  if (!changed) return;
  for (const listener of listeners) listener(next);
}

/** Applies the stored choice before the first render. A stored id that no longer exists gives the default. */
export function initLanguage(): void {
  const stored = readStored(STORAGE_KEY);
  language.choice = isLanguageId(stored) ? stored : DEFAULT_LANGUAGE;
  apply();
  if (!systemWatched && typeof window !== 'undefined') {
    systemWatched = true;
    // With 'auto', a change of the system language applies at once, as a pick does.
    window.addEventListener('languagechange', () => {
      if (language.choice === 'auto') apply();
    });
  }
}

/** Applies and stores a choice. */
export function setLanguage(id: LanguageId): void {
  if (!isLanguageId(id)) return;
  language.choice = id;
  writeStored(STORAGE_KEY, id);
  apply();
}
