import { isDesktop, setWebviewZoom, windowBaseSize } from './platform.ts';
import { onPrefsReset, readPrefs, savePrefs } from './prefs.ts';
import { TUNING } from './tuning/index.ts';

// The size of the whole interface (the View menu), stored. The desktop app zooms its webview, so the layout px, the
// media queries and the device pixel ratio change together. A browser page cannot set the browser zoom: there the
// root gets the CSS `zoom`, and the code that mixes client px (pointer events, client rects, the window size) with
// layout px converts them with `uiZoom`, `localRect` and `localViewport`.

/** Also read by public/ui-size-init.js before the first paint, with the same storage prefix. */
const STORE_KEY = 'ui-size';
const STORE_VERSION = 1;
const DEFAULT_SIZE = 100;
const STEPS: readonly number[] = TUNING.ui.uiSize.steps;
/** A desktop native call that does not answer must not hold the first render. */
const INIT_TIMEOUT_MS = 400;

/** The nearest step to a stored value; a value that is not a number gives 100%. */
export function cleanUiSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SIZE;
  return STEPS.reduce((best, step) => (Math.abs(step - value) < Math.abs(best - value) ? step : best), DEFAULT_SIZE);
}

/** The size that applies: a size above 100% stops at the largest step that the window can hold. */
function appliedSize(chosen: number, fit: number): number {
  if (chosen <= DEFAULT_SIZE) return chosen;
  let best = DEFAULT_SIZE;
  for (const step of STEPS) if (step > DEFAULT_SIZE && step <= chosen && step <= fit * 100 + 0.01) best = step;
  return best;
}

let cssFactor = 1;

/** The CSS `zoom` of the root in a browser, 1 = none; always 1 on desktop, where the webview zoom does the work. */
export function uiZoom(): number {
  return cssFactor;
}

/** A client rect (from `getBoundingClientRect`) in the layout px of the zoomed root. */
export function localRect(rect: DOMRectReadOnly): DOMRect {
  const z = cssFactor;
  return z === 1 ? DOMRect.fromRect(rect) : new DOMRect(rect.x / z, rect.y / z, rect.width / z, rect.height / z);
}

/** The window size in the layout px of the zoomed root: the room for a fixed popup. */
export function localViewport(): { width: number; height: number } {
  return { width: window.innerWidth / cssFactor, height: window.innerHeight / cssFactor };
}

class UiSize {
  /** The step that the user picked, in percent. */
  chosen = $state(cleanUiSize(readPrefs(STORE_KEY, STORE_VERSION)?.size));
  /** The largest zoom factor at which the window still holds the editor layout. */
  fit = $state(Infinity);
  readonly applied = $derived(appliedSize(this.chosen, this.fit));

  private next(): number | null {
    return STEPS.find((step) => step > this.applied) ?? null;
  }

  private previous(): number | null {
    return STEPS.findLast((step) => step < this.applied) ?? null;
  }

  get canGrow(): boolean {
    const next = this.next();
    return next !== null && next <= this.fit * 100 + 0.01;
  }

  get canShrink(): boolean {
    return this.previous() !== null;
  }

  get canReset(): boolean {
    return this.chosen !== DEFAULT_SIZE;
  }

  /** One step up or down from the size that applies now; returns the new size. */
  step(direction: 1 | -1): number {
    const target = direction > 0 ? this.next() : this.previous();
    if (target !== null) this.set(target);
    return this.applied;
  }

  reset(): void {
    this.set(DEFAULT_SIZE);
  }

  private set(size: number): void {
    this.chosen = cleanUiSize(size);
    savePrefs(STORE_KEY, STORE_VERSION, { size: this.chosen });
    applyNow();
  }
}

export const uiSize = new UiSize();

let shown = 0;

/** Puts the size that applies on the page; a size that is already on the page is not set again. */
function applyNow(): Promise<void> {
  const size = uiSize.applied;
  if (size === shown) return Promise.resolve();
  shown = size;
  const factor = size / 100;
  if (isDesktop) return setWebviewZoom(factor);
  cssFactor = factor;
  const root = document.documentElement.style;
  if (size === DEFAULT_SIZE) {
    root.removeProperty('zoom');
    root.removeProperty('--ui-zoom');
  } else {
    root.setProperty('zoom', String(factor));
    root.setProperty('--ui-zoom', String(factor));
  }
  return Promise.resolve();
}

/** The window size in CSS px at 100%: the browser zoom counts, the CSS zoom of the root does not. */
async function baseSize(): Promise<{ width: number; height: number }> {
  return (await windowBaseSize()) ?? { width: window.innerWidth, height: window.innerHeight };
}

async function measure(): Promise<void> {
  const { width, height } = await baseSize();
  const { w, h } = TUNING.ui.uiSize.layoutMinPx;
  uiSize.fit = Math.min(width / w, height / h);
  await applyNow();
}

let measuring = 0;

/** Applies the stored size before the first render and follows the window size after it. */
export async function initUiSize(): Promise<void> {
  // The early script may have set the zoom already; the state starts from what is on the page.
  const root = document.documentElement.style;
  const early = Number(root.getPropertyValue('--ui-zoom'));
  if (!isDesktop && early > 0) {
    cssFactor = early;
    shown = Math.round(early * 100);
  } else {
    // On desktop the webview zoom does the work: a CSS zoom on top of it would count twice.
    root.removeProperty('zoom');
    root.removeProperty('--ui-zoom');
    shown = DEFAULT_SIZE;
  }
  window.addEventListener('resize', () => {
    if (measuring) return;
    measuring = requestAnimationFrame(() => {
      measuring = 0;
      void measure();
    });
  });
  await Promise.race([measure(), new Promise((resolve) => setTimeout(resolve, INIT_TIMEOUT_MS))]);
}

onPrefsReset(() => {
  uiSize.chosen = DEFAULT_SIZE;
  void applyNow();
});
