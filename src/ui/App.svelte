<script lang="ts">
  import { onMount } from 'svelte';
  import { runAction } from '../app/actions/index.ts';
  import { keyHud } from '../app/key-hud.svelte.ts';
  import { app, isImageFile } from '../app/state.svelte.ts';
  import { sideWidth } from '../app/side-width.svelte.ts';
  import { t } from '../app/i18n/index.ts';
  import { guardWindowClose, launchFile, setWindowTitle } from '../app/platform.ts';
  import * as sfx from '../app/sfx.ts';
  import { matchShortcut, type ActionId } from '../app/shortcuts.ts';
  import { TOOLS } from '../app/tools/index.ts';
  import ConfirmDialog from './base/ConfirmDialog.svelte';
  import KeyHud from './base/KeyHud.svelte';
  import ProgressPill from './base/ProgressPill.svelte';
  import Toasts from './base/Toasts.svelte';
  import AboutDialog from './dialogs/AboutDialog.svelte';
  import CanvasSizeDialog from './dialogs/CanvasSizeDialog.svelte';
  import ExportDialog from './dialogs/ExportDialog.svelte';
  import ImageSizeDialog from './dialogs/ImageSizeDialog.svelte';
  import NewImageDialog from './dialogs/NewImageDialog.svelte';
  import ShortcutsDialog from './dialogs/ShortcutsDialog.svelte';
  import EditorStage from './EditorStage.svelte';
  import HintBar from './HintBar.svelte';
  import OptionsBar from './OptionsBar.svelte';
  import RightPanel from './RightPanel.svelte';
  import SideResizer from './SideResizer.svelte';
  import StatusBar from './StatusBar.svelte';
  import ToolRail from './ToolRail.svelte';
  import TopBar from './TopBar.svelte';
  import Welcome from './Welcome.svelte';

  const DEV = import.meta.env.DEV;
  /** Actions that a held key repeats; the others run once for each press. */
  const REPEATABLE = new Set<ActionId>(['edit.undo', 'edit.redo', 'view.zoomIn', 'view.zoomOut', 'paint.sizeDown', 'paint.sizeUp', 'paint.hardnessDown', 'paint.hardnessUp']);
  let dragDepth = 0;

  function hasFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes('Files') ?? false;
  }

  function dialogOpen(): boolean {
    return app.confirmRequest !== null || app.dialog !== 'none';
  }

  // Without these guards the WebView navigates to a file dropped anywhere on the window.
  function onDragEnter(event: DragEvent): void {
    event.preventDefault();
    if (!hasFiles(event)) return;
    dragDepth++;
    app.dragActive = !dialogOpen();
  }

  function onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = hasFiles(event) && !dialogOpen() ? 'copy' : 'none';
  }

  function onDragLeave(event: DragEvent): void {
    event.preventDefault();
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) app.dragActive = false;
  }

  /** The stage and the welcome screen take their own drops; a drop on the rest of the editor adds layers. */
  function onDrop(event: DragEvent): void {
    const handled = event.defaultPrevented;
    event.preventDefault();
    dragDepth = 0;
    app.dragActive = false;
    if (handled || !app.doc || dialogOpen()) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) void app.openFiles(files, 'auto');
  }

  function isEditable(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  /** The welcome screen takes its own paste; in the editor an image becomes a layer. */
  function onPaste(event: ClipboardEvent): void {
    if (!app.doc || dialogOpen() || isEditable(event.target)) return;
    const items = Array.from(event.clipboardData?.items ?? []);
    const files = items.filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    const images = files.filter(isImageFile);
    event.preventDefault();
    if (images.length === 0) {
      app.refuse(files.length > 0 ? t('toast.notImage') : t('toast.nothingToPaste'));
      return;
    }
    void app.openFiles(images, 'auto');
  }

  /** Browser shortcuts that break the feel of a desktop app. Dev mode keeps the reload and search keys for debugging. */
  function blockBrowserKeys(event: KeyboardEvent): void {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && (key === 's' || key === 'j' || key === 'u')) {
      event.preventDefault();
      return;
    }
    if (DEV) return;
    if (event.key === 'F5' || (mod && (key === 'r' || key === 'p' || key === 'f'))) event.preventDefault();
  }

  /** Key order: an editable target keeps its keys (unless whileTyping), then the active tool, then the shortcuts. */
  function onKeyDown(event: KeyboardEvent): void {
    keyHud.keyDown(event);
    // A focused control or the stage already used this key.
    const taken = event.defaultPrevented;
    blockBrowserKeys(event);
    if (taken) return;
    const typing = isEditable(event.target);
    const def = matchShortcut(event);
    if (typing && !def?.whileTyping) return;
    if (dialogOpen()) return;
    // A button that the keyboard focused takes its own Enter: Enter on "Cancel" must not apply the crop.
    // A button focused by a mouse click is not a choice, so Enter still goes to the tool.
    const onButton = event.target instanceof HTMLElement && /^(BUTTON|SUMMARY|A)$/.test(event.target.tagName) && event.target.matches(':focus-visible');
    if (onButton && event.key === 'Enter') return;
    if (!typing && app.doc && TOOLS[app.tool]?.key?.(event)) {
      event.preventDefault();
      return;
    }
    if (!def) return;
    event.preventDefault();
    if (event.repeat && !REPEATABLE.has(def.id)) return;
    runAction(def.id, 'key');
  }

  function onContextMenu(event: MouseEvent): void {
    if (DEV || isEditable(event.target)) return;
    event.preventDefault();
  }

  function onWheel(event: WheelEvent): void {
    if (event.ctrlKey) event.preventDefault();
  }

  $effect(() => {
    const doc = app.doc;
    const name = t('app.name');
    void setWindowTitle(doc ? `${doc.history.dirty ? '• ' : ''}${doc.name} - ${name}` : name);
  });

  onMount(() => {
    window.addEventListener('wheel', onWheel, { passive: false });
    let disposed = false;
    let unguard: (() => void) | null = null;
    guardWindowClose(
      () => app.doc?.history.dirty ?? false,
      () => app.confirm(t('chrome.quit.title'), t('chrome.quit.body'), t('chrome.quit.confirm')),
    )
      .then((cleanup) => {
        if (disposed) cleanup();
        else unguard = cleanup;
      })
      .catch(() => {});
    launchFile()
      .then((file) => {
        if (file) void app.openFiles([new File([file.bytes as Uint8Array<ArrayBuffer>], file.name)], 'document');
      })
      .catch(() => {
        sfx.play('error');
        app.toast(t('error.read'), 'error');
      });
    return () => {
      disposed = true;
      unguard?.();
      window.removeEventListener('wheel', onWheel);
    };
  });
</script>

<svelte:window
  ondragenter={onDragEnter}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  onpaste={onPaste}
  onkeydown={onKeyDown}
  onkeyup={(event) => keyHud.keyUp(event)}
  onblur={() => keyHud.reset()}
  oncontextmenu={onContextMenu}
/>

<main class="app" aria-label={t('app.mainLabel')}>
  {#if app.doc}
    <div class="editor" style:--side-w={sideWidth.width === null ? null : `${sideWidth.width}px`}>
      <div class="area-top"><TopBar /></div>
      <div class="area-rail"><ToolRail /></div>
      <div class="area-options"><OptionsBar /></div>
      <div class="area-stage">
        <EditorStage />
        <KeyHud />
      </div>
      <div class="area-hints"><HintBar /></div>
      <div class="area-side">
        <RightPanel />
        <SideResizer />
      </div>
      <div class="area-status"><StatusBar /></div>
    </div>
  {:else}
    <Welcome onfiles={(files) => void app.openFiles(files, 'document')} onnew={() => app.openDialog('new-image')} />
    <div class="welcome-hud"><KeyHud /></div>
  {/if}
</main>

<NewImageDialog />
<ShortcutsDialog />
<AboutDialog />
<CanvasSizeDialog />
<ImageSizeDialog />
<ExportDialog />
<ProgressPill />
<Toasts />
<ConfirmDialog />

<style>
  @layer components {
    .app {
      height: 100dvh;
      overflow: hidden;
    }

    .editor {
      display: grid;
      grid-template:
        'top top top' auto
        'rail options side' auto
        'rail stage side' minmax(0, 1fr)
        'rail hints side' auto
        'status status status' auto
        / var(--rail-w) minmax(0, 1fr) var(--side-w, var(--panel-w));
      height: 100%;
      min-width: 960px;
      min-height: 640px;
      animation: editor-in var(--dur-screen) var(--ease-out);
    }

    .area-top {
      grid-area: top;
    }

    .area-rail {
      display: grid;
      grid-area: rail;
      min-height: 0;
    }

    .area-options {
      grid-area: options;
      min-width: 0;
    }

    .area-stage {
      position: relative;
      display: grid;
      grid-area: stage;
      min-width: 0;
      min-height: 0;
      background: var(--stage-bg);
    }

    .area-hints {
      grid-area: hints;
      min-width: 0;
    }

    .area-side {
      position: relative;
      display: grid;
      grid-area: side;
      min-width: 0;
      min-height: 0;
    }

    .area-status {
      grid-area: status;
    }

    .welcome-hud {
      position: fixed;
      inset: auto 0 var(--space-4);
      pointer-events: none;
    }

    @keyframes editor-in {
      from {
        opacity: 0;
        scale: 0.985;
      }
    }
  }
</style>
