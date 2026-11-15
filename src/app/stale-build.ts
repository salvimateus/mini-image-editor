import { errorCode, errorMessage } from '../core/errors.ts';
import { isDesktop } from './platform.ts';
import { TUNING } from './tuning/index.ts';

const ENTRY_SCRIPT = 'script[type="module"][src]';
// The messages of a module, worker or WASM file that did not load, in Chromium, Firefox and Safari.
const LOAD_MESSAGE = /dynamically imported module|module script|failed to fetch|networkerror|load failed|webassembly|\.wasm|worker error/i;

let running: Promise<boolean> | null = null;
let stale = false;

/** True for an error that a missing app file can cause: every internal error, and a codec error about a load. */
export function isLoadFailure(error: unknown): boolean {
  return errorCode(error) === 'internal' || LOAD_MESSAGE.test(errorMessage(error));
}

function entryOf(root: ParentNode): string | null {
  return root.querySelector(ENTRY_SCRIPT)?.getAttribute('src') ?? null;
}

async function compareEntry(): Promise<boolean> {
  const own = entryOf(document);
  if (!own) return false;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TUNING.ui.staleCheckTimeoutMs);
  try {
    const response = await fetch(import.meta.env.BASE_URL, { cache: 'no-store', signal: abort.signal });
    if (!response.ok) return false;
    const live = entryOf(new DOMParser().parseFromString(await response.text(), 'text/html'));
    return live !== null && live !== own;
  } catch {
    // Offline or too slow: no proof of a new version.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True when the server has a newer build than the one that this page runs: its entry script is different.
 * Always false in the desktop app and in dev. Calls at the same time share one check; a true result stays true.
 */
export function checkStaleBuild(): Promise<boolean> {
  if (isDesktop || import.meta.env.DEV) return Promise.resolve(false);
  if (stale) return Promise.resolve(true);
  running ??= compareEntry().then((result) => {
    stale = result;
    running = null;
    return result;
  });
  return running;
}
