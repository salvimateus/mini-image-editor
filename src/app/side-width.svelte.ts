import { numField, onPrefsReset, readPrefs, savePrefs } from './prefs.ts';
import { TUNING } from './tuning/index.ts';

const STORE_KEY = 'side-width';
const STORE_VERSION = 1;

/** A whole width inside the limits, or null (the `--panel-w` default) for a value that is not a number. */
export function cleanSideWidth(value: unknown): number | null {
  const { min, max } = TUNING.ui.sideWidth;
  return typeof value === 'number' && Number.isFinite(value) ? numField(value, min, { min, max }, true) : null;
}

/** The width of the right column that the user set, stored; null keeps the default of the `--panel-w` token. */
class SideWidth {
  width = $state<number | null>(cleanSideWidth(readPrefs(STORE_KEY, STORE_VERSION)?.width));

  set(width: number | null): void {
    this.width = width === null ? null : cleanSideWidth(width);
    savePrefs(STORE_KEY, STORE_VERSION, { width: this.width });
  }
}

export const sideWidth = new SideWidth();

onPrefsReset(() => (sideWidth.width = null));
