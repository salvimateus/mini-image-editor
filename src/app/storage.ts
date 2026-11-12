const PREFIX = 'mini-image-editor:';

/** localStorage keeps only conveniences, and it can be missing or blocked. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage is a convenience only: the app works the same without it.
  }
}

/** Removes every key of the app; keys of other origins or prefixes stay. */
export function clearStored(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}
