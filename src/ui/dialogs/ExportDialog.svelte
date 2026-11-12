<script lang="ts">
  import { untrack } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { Tween } from 'svelte/motion';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { icoSizes } from '../../core/encode/ico.ts';
  import { fitsFormat } from '../../core/encode/limits.ts';
  import { EXPORT_FORMATS, FORMAT_INFO } from '../../core/formats.ts';
  import { PARAMS } from '../../core/params/index.ts';
  import type { ExportFormat, RasterImage } from '../../core/types.ts';
  import type { EditorDoc } from '../../app/doc.svelte.ts';
  import { exportOptions } from '../../app/estimate.svelte.ts';
  import { formatBytes, t, type TextKey } from '../../app/i18n/index.ts';
  import { isDesktop, revealFile, saveFile, type SaveResult } from '../../app/platform.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app, prefersReducedMotion } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import Burst from '../base/Burst.svelte';
  import Dialog from '../base/Dialog.svelte';
  import FileNameField from '../base/FileNameField.svelte';
  import SizeDelta from '../base/SizeDelta.svelte';
  import SliderField from '../base/SliderField.svelte';

  type Phase = 'encoding' | 'ready' | 'error' | 'saving' | 'saved';

  interface Encoded {
    key: string;
    bytes: Uint8Array;
    plainBytes: number;
  }

  const LABELS: Record<ExportFormat, TextKey> = {
    png: 'export.format.png',
    webp: 'export.format.webp',
    jpeg: 'export.format.jpeg',
    ico: 'export.format.ico',
  };
  const DESCRIPTIONS: Record<ExportFormat, TextKey> = {
    png: 'export.desc.png',
    webp: 'export.desc.webp',
    jpeg: 'export.desc.jpeg',
    ico: 'export.desc.ico',
  };

  const open = $derived(app.dialog === 'export');

  let phase = $state<Phase>('encoding');
  let format = $state<ExportFormat>('png');
  let quality = $state<number>(TUNING.ui.exportDefaults.jpegQuality);
  let name = $state('');
  let nameInvalid = $state(false);
  let progress = $state(0);
  let width = $state(0);
  let height = $state(0);
  let sourceBytes = $state<number | null>(null);
  let encoded = $state.raw<Encoded | null>(null);
  let saved = $state.raw<{ fileName: string; path: string | null } | null>(null);
  let burst = $state(0);

  const shownBytes = new Tween(0, { easing: cubicOut });

  // Plain fields: the encode loop reads them outside of any effect.
  let doc: EditorDoc | null = null;
  let image: RasterImage | null = null;
  let session = 0;
  let running = false;
  let qualityTimer: ReturnType<typeof setTimeout> | undefined;

  const key = $derived(keyOf(format, quality));
  /** The bytes of the current settings, or null while they are made. */
  const current = $derived(encoded && encoded.key === key ? encoded : null);
  /** The icon sizes that this image gives: no size larger than the image. */
  const icoList = $derived(icoSizes(PARAMS.export.icoSizes, Math.max(width, height)));
  const canSave = $derived(phase === 'ready' && current !== null && !nameInvalid);

  function keyOf(f: ExportFormat, q: number): string {
    return f === 'jpeg' ? `jpeg:${q}` : f;
  }

  $effect(() => {
    if (open) untrack(begin);
    else untrack(end);
  });

  $effect(() => {
    if (!open) return;
    return app.engine.onProgress((ratio) => {
      if (phase === 'encoding') progress = ratio;
    });
  });

  function begin(): void {
    const next = app.doc;
    if (!next) {
      app.openDialog('none');
      return;
    }
    session++;
    doc = next;
    image = next.flatten();
    width = next.width;
    height = next.height;
    sourceBytes = next.sourceBytes;
    name = next.name;
    nameInvalid = false;
    quality = app.jpegQuality;
    format = fitsFormat(app.lastFormat, width, height) ? app.lastFormat : 'png';
    encoded = null;
    saved = null;
    progress = 0;
    phase = 'encoding';
    void shownBytes.set(0, { duration: 0 });
    void encode();
  }

  function end(): void {
    session++;
    clearTimeout(qualityTimer);
    image = null;
    doc = null;
  }

  /** The saved screen replaces the form: its main button takes the focus, so Enter closes the dialog. */
  function focusNow(node: HTMLElement): void {
    node.focus();
  }

  function cancel(): void {
    sfx.play('cancel');
    close();
  }

  function close(): void {
    app.openDialog('none');
  }

  /** Encodes the current settings; a change during an encode starts one more encode when it ends, so no stale file is kept. */
  async function encode(): Promise<void> {
    if (running || !image) return;
    running = true;
    const mine = session;
    try {
      while (mine === session && image) {
        const wanted = key;
        if (encoded?.key === wanted) {
          phase = 'ready';
          return;
        }
        const options = exportOptions(format, quality);
        phase = 'encoding';
        progress = 0;
        try {
          const result = await app.engine.exportImage(image, options);
          if (mine !== session) return;
          if (key !== wanted) continue;
          encoded = { key: wanted, bytes: result.bytes, plainBytes: result.plainBytes };
          phase = 'ready';
          void shownBytes.set(result.bytes.length, { duration: prefersReducedMotion() ? 0 : TUNING.export.countMs });
          return;
        } catch (error) {
          if (mine !== session) return;
          if (key !== wanted) continue;
          encoded = null;
          phase = 'error';
          app.fail(error);
          return;
        }
      }
    } finally {
      running = false;
      // A new opening of the dialog came while this loop waited: it starts its own encode now.
      if (mine !== session && image) void encode();
    }
  }

  function settingsChanged(): void {
    clearTimeout(qualityTimer);
    if (current) {
      phase = 'ready';
      return;
    }
    phase = 'encoding';
    void encode();
  }

  function chooseFormat(next: ExportFormat): void {
    if (phase === 'saving') return;
    if (!fitsFormat(next, width, height)) {
      sfx.play('error');
      return;
    }
    if (next === format) return;
    sfx.play('tick');
    format = next;
    settingsChanged();
  }

  function onQualityInput(value: number): void {
    quality = value;
    phase = 'encoding';
    clearTimeout(qualityTimer);
    qualityTimer = setTimeout(settingsChanged, TUNING.export.qualityDelayMs);
  }

  function onQualityChange(value: number): void {
    quality = value;
    settingsChanged();
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const file = current;
    const target = doc;
    if (!canSave || !file || !target) {
      if (nameInvalid) sfx.play('error');
      return;
    }
    const mine = session;
    const savedFormat = format;
    const savedQuality = quality;
    const base = name;
    phase = 'saving';
    let result: SaveResult;
    try {
      result = await saveFile(file.bytes, base, savedFormat);
    } catch {
      if (mine !== session) return;
      sfx.play('error');
      app.toast(t('export.saveFailed'), 'error');
      phase = 'ready';
      return;
    }
    if (result.status === 'cancelled') {
      if (mine === session) phase = 'ready';
      return;
    }
    // The file exists from here on, even when the dialog closed meanwhile.
    target.history.markClean();
    target.name = base;
    app.setExportPrefs({ format: savedFormat, jpegQuality: savedQuality });
    sfx.play('saved');
    if (mine !== session) return;
    saved = { fileName: `${base}.${FORMAT_INFO[savedFormat].ext}`, path: result.status === 'saved' ? result.path : null };
    phase = 'saved';
    burst++;
  }

  async function reveal(): Promise<void> {
    const path = saved?.path;
    if (!path) return;
    sfx.play('tick');
    try {
      await revealFile(path);
    } catch {
      sfx.play('error');
      app.toast(t('export.revealFailed'), 'error');
    }
  }

  function retry(): void {
    sfx.play('tick');
    settingsChanged();
  }
</script>

<Dialog {open} labelledby="export-title" onclose={close} wide>
  <div class="export">
    {#if phase === 'saved' && saved}
      <div class="dialog-body saved" role="status">
        <span class="saved-icon" aria-hidden="true"><CircleCheck size={44} /></span>
        <h2 id="export-title" class="dialog-title">{t('export.savedTitle')}</h2>
        <p class="hint saved-text">
          {saved.path ? t('export.savedBody', { name: saved.fileName }) : t('export.downloadedBody', { name: saved.fileName })}
        </p>
        <div class="dialog-actions saved-actions">
          {#if isDesktop && saved.path}
            <button type="button" class="btn btn-quiet" onclick={reveal}><FolderOpen size={18} />{t('export.reveal')}</button>
          {/if}
          <button type="button" class="btn btn-primary" onclick={close} {@attach focusNow}>{t('common.close')}</button>
        </div>
      </div>
    {:else}
      <form class="dialog-body" onsubmit={save}>
        <header class="head">
          <h2 id="export-title" class="dialog-title">{t('export.title')}</h2>
          <span class="dims">{t('export.dimensions', { w: width, h: height })}</span>
        </header>

        <fieldset class="group">
          <legend class="field-label">{t('export.format')}</legend>
          <div class="formats">
            {#each EXPORT_FORMATS as entry (entry)}
              {@const usable = fitsFormat(entry, width, height)}
              <button
                type="button"
                class="format"
                aria-pressed={format === entry}
                aria-disabled={!usable}
                aria-describedby="export-desc-{entry}"
                onclick={() => chooseFormat(entry)}
              >
                <span class="format-name">{t(LABELS[entry])}</span>
                <span class="format-desc" class:is-blocked={!usable} id="export-desc-{entry}">
                  {usable ? t(DESCRIPTIONS[entry]) : t('export.tooLarge', { max: FORMAT_INFO[entry].maxSide, w: width, h: height })}
                </span>
              </button>
            {/each}
          </div>
        </fieldset>

        {#if format === 'jpeg'}
          <div class="group">
            <SliderField
              id="export-quality"
              label={t('export.quality')}
              value={quality}
              min={TUNING.export.quality.min}
              max={TUNING.export.quality.max}
              step={TUNING.export.quality.step}
              reset={TUNING.ui.exportDefaults.jpegQuality}
              disabled={phase === 'saving'}
              oninput={onQualityInput}
              onchange={onQualityChange}
            />
            <p class="hint note"><TriangleAlert size={16} />{t('export.jpegNote')}</p>
          </div>
        {:else if format === 'ico'}
          <div class="group">
            <span class="field-label">{t('export.icoSizes')}</span>
            <ul class="chips">
              {#each icoList as size (size)}
                <li class="chip">{t('export.sizePx', { size })}</li>
              {/each}
            </ul>
            <p class="hint">{icoList.length < PARAMS.export.icoSizes.length ? t('export.icoSmall') : t('export.icoNote')}</p>
          </div>
        {/if}

        <div class="row">
          <span class="field-label">{t('export.fileName')}</span>
          <FileNameField
            id="export"
            base={name}
            ext={FORMAT_INFO[format].ext}
            disabled={phase === 'saving'}
            align="end"
            onrename={(next) => (name = next)}
            oninvalid={(invalid) => (nameInvalid = invalid)}
          />
        </div>

        <section class="weight" aria-labelledby="export-weight-title">
          <div class="weight-head">
            <span class="field-label" id="export-weight-title">{t('export.weight')}</span>
            {#if current}
              <span class="weight-big">{formatBytes(Math.round(shownBytes.current))}</span>
            {/if}
          </div>
          {#if phase === 'error'}
            <div class="weight-error" role="alert">
              <span class="error-text"><TriangleAlert size={16} />{t('export.failed')}</span>
              <button type="button" class="btn btn-small btn-quiet" onclick={retry}><RefreshCw size={16} />{t('export.retry')}</button>
            </div>
          {:else if current}
            <div class="weight-row">
              <span class="hint">{t('export.compare')}</span>
              <SizeDelta before={current.plainBytes} after={current.bytes.length} optimize />
            </div>
          {:else}
            <div class="weight-row" role="status">
              <span class="hint">{t('export.encoding')}</span>
              <span
                class="track"
                role="progressbar"
                aria-label={t('export.encoding')}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={Math.round(progress * 100)}
              >
                <span class="bar" style:transform="scaleX({Math.max(0.04, progress)})"></span>
              </span>
            </div>
          {/if}
          {#if sourceBytes !== null}
            <div class="weight-row">
              <span class="hint">{t('export.original')}</span>
              <span class="original">{formatBytes(sourceBytes)}</span>
            </div>
          {/if}
        </section>

        <div class="dialog-actions">
          <button type="button" class="btn btn-quiet" onclick={cancel}>{t('common.cancel')}</button>
          <button type="submit" class="btn btn-primary" disabled={!canSave} aria-busy={phase === 'saving'}>
            {phase === 'saving' ? t('export.saving') : t('export.save')}
          </button>
        </div>
      </form>
    {/if}
    <Burst trigger={burst} count={TUNING.ui.confettiCount} colors={TUNING.export.confettiColors} kind="confetti" />
  </div>
</Dialog>

<style>
  @layer components {
    .export {
      position: relative;
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-1) var(--space-3);
    }

    .dims {
      color: var(--text-faint);
      font-size: 0.875rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .group {
      display: grid;
      gap: var(--space-2);
      min-width: 0;
      border: 0;
    }

    .formats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
      gap: var(--space-2);
    }

    .format {
      display: grid;
      align-content: start;
      gap: 2px;
      padding: var(--space-2) var(--space-3);
      text-align: left;
      background: var(--surface-2);
      border: 2px solid var(--line);
      border-radius: var(--radius-m);
      box-shadow: 0 3px 0 var(--depth);
      transition:
        transform var(--dur-hover) var(--ease-sym),
        border-color var(--dur-hover) var(--ease-sym),
        background-color var(--dur-hover) var(--ease-sym);

      &:hover:not([aria-disabled='true']) {
        transform: translateY(-2px);
        border-color: var(--line-strong);
      }

      &:active:not([aria-disabled='true']) {
        transform: translateY(2px);
        transition-duration: 60ms;
      }

      &[aria-pressed='true'] {
        background: var(--primary-fill);
        border-color: var(--primary);
      }

      &[aria-disabled='true'] {
        cursor: not-allowed;
        box-shadow: none;
        background: var(--surface-sunken);
      }
    }

    .format-name {
      font: 800 1rem/1.2 var(--font-display);

      .format[aria-disabled='true'] & {
        color: var(--text-faint);
      }
    }

    .format-desc {
      color: var(--text-muted);
      font-size: 0.8125rem;
      line-height: 1.35;

      &.is-blocked {
        color: var(--danger-text);
      }
    }

    .note {
      display: flex;
      align-items: flex-start;
      gap: var(--space-2);

      & :global(svg) {
        flex: none;
        margin-top: 1px;
        color: var(--yellow);
      }
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
      padding: 0;
      margin: 0;
      list-style: none;
    }

    .chip {
      padding: 2px 10px;
      color: var(--text-muted);
      background: var(--surface-3);
      border-radius: var(--radius-pill);
      font-size: 0.75rem;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
    }

    .row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;
    }

    .weight {
      display: grid;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
      background: var(--surface-sunken);
      border: 2px solid var(--line);
      border-radius: var(--radius-l);
    }

    .weight-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-3);
      min-height: 2rem;
    }

    .weight-big {
      font: 800 1.5rem/1 var(--font-display);
      font-variant-numeric: tabular-nums;
      color: var(--mint);
    }

    .weight-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-1) var(--space-3);
      min-height: 1.75rem;
    }

    .original {
      font-size: 0.8125rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
    }

    .track {
      flex: 1 1 120px;
      max-width: 240px;
      height: 8px;
      overflow: hidden;
      background: var(--surface-3);
      border-radius: var(--radius-pill);
    }

    .bar {
      display: block;
      height: 100%;
      background: var(--teal);
      border-radius: inherit;
      transform-origin: left center;
      transition: transform var(--dur-pop) var(--ease-out);
    }

    .weight-error {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }

    .error-text {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--danger-text);
      font-size: 0.875rem;
      font-weight: 700;
    }

    .saved {
      justify-items: center;
      text-align: center;
    }

    .saved-icon {
      display: grid;
      place-items: center;
      color: var(--mint);
      animation: saved-pop var(--dur-modal) var(--ease-spring);
    }

    .saved-text {
      overflow-wrap: anywhere;
    }

    .saved-actions {
      justify-content: center;
    }

    @keyframes saved-pop {
      from {
        transform: scale(0.4);
        opacity: 0;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .saved-icon {
        animation: none;
      }

      .bar {
        transition: none;
      }
    }
  }
</style>
