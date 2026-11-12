import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ExportFormat } from '../core/types.ts';
import { FORMAT_INFO } from '../core/formats.ts';
import { flushPrefs } from './prefs.ts';

export type SaveResult =
  | { status: 'saved'; path: string }
  | { status: 'downloaded'; url: string }
  | { status: 'cancelled' };

export interface LaunchedFile {
  name: string;
  bytes: Uint8Array;
}

/** True inside the Tauri window, false in a plain browser. */
export const isDesktop: boolean = isTauri();

let lastDownloadUrl: string | null = null;

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** The extensions that the save dialog offers for a format; the first one is the default. */
function formatExtensions(format: ExportFormat): string[] {
  const ext = FORMAT_INFO[format].ext;
  return format === 'jpeg' ? [ext, 'jpeg'] : [ext];
}

/** Saves an exported file. `name` has no extension: the format gives it. */
export async function saveFile(bytes: Uint8Array, name: string, format: ExportFormat): Promise<SaveResult> {
  const info = FORMAT_INFO[format];
  const fileName = `${name}.${info.ext}`;
  if (isDesktop) {
    const [{ save }, { writeFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')]);
    const path = await save({ defaultPath: fileName, filters: [{ name: info.label, extensions: formatExtensions(format) }] });
    if (!path) return { status: 'cancelled' };
    // The dialog grants write access to this exact path only: another extension would be a forbidden path.
    await writeFile(path, bytes);
    return { status: 'saved', path };
  }

  // The URL stays alive until the next export, so a slow browser still finds the file.
  if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: info.mime }));
  lastDownloadUrl = url;
  download(url, fileName);
  return { status: 'downloaded', url };
}

function download(url: string, name: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

export async function revealFile(path: string): Promise<void> {
  if (!isDesktop) return;
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
  await revealItemInDir(path);
}

/** Opens a web page outside the app: a plain link would navigate the desktop window away from the app. */
export async function openExternal(url: string): Promise<void> {
  if (isDesktop) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

/** The image file given to the exe as its first argument (a file dropped on the icon), if any. */
export async function launchFile(): Promise<LaunchedFile | null> {
  if (!isDesktop) return null;
  const path = await invoke<string | null>('launch_file');
  if (!path) return null;
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const bytes = await readFile(path);
  return { name: baseName(path), bytes };
}

/**
 * Asks before the window closes while `shouldAsk` is true. Desktop: every close request is stopped, and the window
 * is destroyed when no question is needed or when `ask` resolves true. Browser: the native leave prompt. Returns
 * the cleanup.
 */
export async function guardWindowClose(shouldAsk: () => boolean, ask: () => Promise<boolean>): Promise<() => void> {
  if (isDesktop) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    let asking = false;
    const unlisten = await win.onCloseRequested(async (event) => {
      event.preventDefault();
      if (asking) return;
      asking = true;
      try {
        if (!shouldAsk() || (await ask())) {
          flushPrefs();
          await win.destroy();
        }
      } finally {
        asking = false;
      }
    });
    return unlisten;
  }

  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!shouldAsk()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}

/** The title of the window and of the document. A failed native call keeps the old window title. */
export async function setWindowTitle(text: string): Promise<void> {
  document.title = text;
  if (!isDesktop) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTitle(text);
  } catch {
    // The title is a convenience: the app works the same with the old one.
  }
}
