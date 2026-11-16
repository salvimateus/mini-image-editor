<script lang="ts">
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import ImageUp from '@lucide/svelte/icons/image-up';
  import { pickImageFiles } from '../../app/actions/pick-files.ts';
  import { heldCopy, pastedFiles, readSystemImage } from '../../app/clipboard.ts';
  import { t } from '../../app/i18n/index.ts';
  import { app, isImageFile } from '../../app/state.svelte.ts';
  import Dialog from '../base/Dialog.svelte';
  import KeyText from '../base/KeyText.svelte';

  const open = $derived(app.dialog === 'new-tab');
  let dragDepth = $state(0);
  const dragging = $derived(dragDepth > 0);

  $effect(() => {
    if (!open) dragDepth = 0;
  });

  const close = (): void => app.openDialog('none');

  function hasFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes('Files') ?? false;
  }

  function isEditable(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  /** The copy of the app opens with its exact pixels, so it never goes through a PNG encode. */
  function openHeldCopy(): boolean {
    const copy = heldCopy();
    if (!copy) return false;
    app.openImage(copy.image, t('doc.pastedImageName'));
    return true;
  }

  function onPaste(event: ClipboardEvent): void {
    if (!open || app.confirmRequest || isEditable(event.target)) return;
    event.preventDefault();
    if (openHeldCopy()) return;
    const files = pastedFiles(event.clipboardData);
    const images = files.filter(isImageFile);
    if (images.length === 0) {
      app.refuse(files.length > 0 ? t('toast.notImage') : t('toast.nothingToPaste'));
      return;
    }
    void app.openFiles(images, 'document');
  }

  function pasteFromButton(): void {
    if (openHeldCopy()) return;
    void readSystemImage().then((files) => {
      // The user can close the dialog while the browser asks for the clipboard permission.
      if (app.dialog !== 'new-tab') return;
      if (files.length === 0) {
        app.refuse(t('toast.nothingToPaste'));
        return;
      }
      void app.openFiles(files, 'document');
    });
  }

  function openFile(): void {
    // Synchronous, so the file picker still runs inside the user gesture.
    void pickImageFiles().then((files) => {
      if (files.length > 0) void app.openFiles(files, 'document');
    });
  }

  function onDragEnter(event: DragEvent): void {
    if (hasFiles(event)) dragDepth++;
  }

  function onDragLeave(event: DragEvent): void {
    if (hasFiles(event)) dragDepth = Math.max(0, dragDepth - 1);
  }

  function onDragOver(event: DragEvent): void {
    if (!hasFiles(event)) return;
    // preventDefault tells the window handler of App that this zone owns the drag.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  /** preventDefault tells the window handler of App that the drop is used, so it adds no layer. */
  function onDrop(event: DragEvent): void {
    event.preventDefault();
    dragDepth = 0;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) void app.openFiles(files, 'document');
  }
</script>

<svelte:window onpaste={onPaste} />

<Dialog {open} labelledby="new-tab-title" onclose={close}>
  <div class="dialog-body">
    <h2 id="new-tab-title" class="dialog-title">{t('newTab.title')}</h2>

    <div class="drop-zone" class:is-dragging={dragging} role="region" aria-labelledby="new-tab-zone" ondragenter={onDragEnter} ondragleave={onDragLeave} ondragover={onDragOver} ondrop={onDrop}>
      <span class="drop-icon" aria-hidden="true"><ImageUp size={36} strokeWidth={1.75} /></span>
      <p id="new-tab-zone" class="drop-text">
        {#if dragging}{t('newTab.zoneRelease')}{:else}<KeyText text={t('newTab.zone')} />{/if}
      </p>
      <span class="drop-formats">{t('welcome.formats')}</span>
    </div>

    <div class="choices">
      <button type="button" class="btn btn-primary" data-autofocus onclick={openFile}>
        <FolderOpen size={18} />
        {t('newTab.open')}
      </button>
      <button type="button" class="btn" onclick={pasteFromButton}>
        <ClipboardPaste size={18} />
        {t('newTab.paste')}
      </button>
      <button type="button" class="btn" onclick={() => app.openDialog('new-image')}>
        <FilePlus size={18} />
        {t('newTab.blank')}
      </button>
    </div>

    <div class="dialog-actions">
      <button type="button" class="btn btn-quiet" onclick={close}>{t('common.cancel')}</button>
    </div>
  </div>
</Dialog>

<style>
  @layer components {
    .drop-zone {
      position: relative;
      display: grid;
      justify-items: center;
      gap: var(--space-2);
      padding: var(--space-5) var(--space-4);
      text-align: center;
      background:
        repeating-linear-gradient(45deg, transparent 0 14px, var(--stripe) 14px 28px),
        var(--surface-sunken);
      border: 3px dashed var(--line-strong);
      border-radius: var(--radius-l);
      transition: border-color var(--dur-hover) var(--ease-sym);

      &::after {
        content: '';
        position: absolute;
        inset: -3px;
        border-radius: inherit;
        box-shadow:
          0 0 0 5px var(--primary-fill),
          0 0 32px 4px var(--primary-glow);
        opacity: 0;
        transition: opacity var(--dur-pop) var(--ease-sym);
        pointer-events: none;
      }

      &.is-dragging {
        border-style: solid;
        border-color: var(--primary);

        &::after {
          opacity: 1;
        }
      }
    }

    .drop-icon {
      display: grid;
      place-items: center;
      width: 64px;
      height: 64px;
      color: var(--primary);
      background: var(--surface-1);
      border: 2px solid var(--line);
      border-radius: var(--radius-l);
      transition: transform var(--dur-pop) var(--ease-spring);

      .is-dragging & {
        transform: translateY(-4px) rotate(-6deg) scale(1.08);
      }
    }

    .drop-text {
      font-weight: 800;
      font-size: 1.0625rem;
      line-height: 1.6;
    }

    .drop-formats {
      padding: var(--space-1) var(--space-3);
      color: var(--text-muted);
      background: var(--surface-1);
      border-radius: var(--radius-pill);
      font-size: 0.8125rem;
      font-weight: 800;
      letter-spacing: 0.04em;
    }

    .choices {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--space-2);
    }
  }
</style>
