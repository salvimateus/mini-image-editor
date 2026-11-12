<script lang="ts">
  import { untrack } from 'svelte';
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import { PARAMS } from '../../core/params/index.ts';
  import type { Rgba } from '../../core/types.ts';
  import { app } from '../../app/state.svelte.ts';
  import { t, type TextKey } from '../../app/i18n/index.ts';
  import { lastNewImage, saveNewImage, type NewImageBackground } from '../../app/last-used.ts';
  import * as sfx from '../../app/sfx.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import Dialog from '../base/Dialog.svelte';

  type Background = NewImageBackground;

  const PRESET_NAMES: readonly TextKey[] = ['newImage.preset.square', 'newImage.preset.landscape', 'newImage.preset.story', 'newImage.preset.icon'];
  const BACKGROUNDS: readonly { id: Background; label: TextKey; fill: Rgba | null }[] = [
    { id: 'transparent', label: 'newImage.bg.transparent', fill: null },
    { id: 'white', label: 'newImage.bg.white', fill: { r: 255, g: 255, b: 255, a: 255 } },
    { id: 'black', label: 'newImage.bg.black', fill: { r: 0, g: 0, b: 0, a: 255 } },
  ];

  const start = lastNewImage();
  let widthText = $state(String(start.width));
  let heightText = $state(String(start.height));
  let background = $state<Background>(start.background);

  // Each opening starts from the last created image.
  $effect(() => {
    if (app.dialog !== 'new-image') return;
    untrack(() => {
      const last = lastNewImage();
      widthText = String(last.width);
      heightText = String(last.height);
      background = last.background;
    });
  });

  const width = $derived(parseSide(widthText));
  const height = $derived(parseSide(heightText));
  const valid = $derived(width !== null && height !== null && width * height <= PARAMS.limits.maxPixels);

  function parseSide(text: string): number | null {
    const clean = text.trim();
    if (!/^\d+$/.test(clean)) return null;
    const value = Number(clean);
    return value >= 1 && value <= PARAMS.limits.maxSide ? value : null;
  }

  function cancel(): void {
    sfx.play('cancel');
    close();
  }

  function close(): void {
    app.openDialog('none');
  }

  function choose(w: number, h: number): void {
    sfx.play('tick');
    widthText = String(w);
    heightText = String(h);
  }

  function swap(): void {
    sfx.play('tick');
    [widthText, heightText] = [heightText, widthText];
  }

  function create(event: SubmitEvent): void {
    event.preventDefault();
    if (!valid || width === null || height === null) {
      sfx.play('error');
      return;
    }
    const fill = BACKGROUNDS.find((entry) => entry.id === background)?.fill ?? null;
    saveNewImage({ width, height, background });
    close();
    void app.newDocument(width, height, fill);
  }
</script>

<Dialog open={app.dialog === 'new-image'} labelledby="new-image-title" onclose={close}>
  <form class="dialog-body" onsubmit={create}>
    <h2 id="new-image-title" class="dialog-title">{t('newImage.title')}</h2>

    <fieldset class="group">
      <legend class="field-label">{t('newImage.presets')}</legend>
      <div class="presets">
        {#each TUNING.ui.newImagePresets as preset, index (index)}
          <button
            type="button"
            class="preset"
            aria-pressed={width === preset.w && height === preset.h}
            onclick={() => choose(preset.w, preset.h)}
          >
            <span class="preset-shape" style:aspect-ratio="{preset.w} / {preset.h}" aria-hidden="true"></span>
            <span class="preset-name">{t(PRESET_NAMES[index])}</span>
            <span class="preset-size">{preset.w} × {preset.h}</span>
          </button>
        {/each}
      </div>
    </fieldset>

    <div class="sides">
      <label class="field">
        <span class="field-label">{t('newImage.width')}</span>
        <input class="number-input" name="new-width" data-autofocus inputmode="numeric" autocomplete="off" bind:value={widthText} aria-invalid={width === null} />
      </label>
      <button type="button" class="icon-btn swap" aria-label={t('newImage.swap')} title={t('newImage.swap')} onclick={swap}>
        <ArrowLeftRight size={18} />
      </button>
      <label class="field">
        <span class="field-label">{t('newImage.height')}</span>
        <input class="number-input" name="new-height" inputmode="numeric" autocomplete="off" bind:value={heightText} aria-invalid={height === null} />
      </label>
    </div>

    {#if !valid}
      <p class="hint invalid" role="alert">{t('newImage.invalid', { max: PARAMS.limits.maxSide, mp: Math.round(PARAMS.limits.maxPixels / 1e6) })}</p>
    {/if}

    <fieldset class="group">
      <legend class="field-label">{t('newImage.background')}</legend>
      <div class="segmented">
        {#each BACKGROUNDS as entry (entry.id)}
          <button
            type="button"
            aria-pressed={background === entry.id}
            onclick={() => {
              sfx.play('tick');
              background = entry.id;
            }}
          >
            <span class="swatch swatch-{entry.id}" aria-hidden="true"></span>
            {t(entry.label)}
          </button>
        {/each}
      </div>
    </fieldset>

    <div class="dialog-actions">
      <button type="button" class="btn btn-quiet" onclick={cancel}>{t('common.cancel')}</button>
      <button type="submit" class="btn btn-primary" disabled={!valid}>{t('newImage.create')}</button>
    </div>
  </form>
</Dialog>

<style>
  @layer components {
    .group {
      display: grid;
      gap: var(--space-2);
      min-width: 0;
      border: 0;
    }

    .presets {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: var(--space-2);
    }

    .preset {
      display: grid;
      justify-items: center;
      align-content: end;
      gap: var(--space-1);
      padding: var(--space-3) var(--space-1) var(--space-2);
      background: var(--surface-2);
      border: 2px solid var(--line);
      border-radius: var(--radius-m);
      box-shadow: 0 3px 0 var(--depth);
      transition:
        transform var(--dur-hover) var(--ease-spring),
        border-color var(--dur-hover) var(--ease-sym),
        background-color var(--dur-hover) var(--ease-sym);

      &:hover {
        transform: translateY(-2px);
        border-color: var(--line-strong);
      }

      &:active {
        transform: translateY(2px);
        transition-duration: 60ms;
      }

      &[aria-pressed='true'] {
        background: var(--primary-fill);
        border-color: var(--primary);
      }
    }

    .preset-shape {
      height: 34px;
      max-width: 52px;
      background: var(--surface-3);
      border: 2px solid var(--line-strong);
      border-radius: 4px;

      .preset[aria-pressed='true'] & {
        background: var(--primary);
        border-color: var(--primary-edge);
      }
    }

    .preset-name {
      font-weight: 800;
      font-size: 0.8125rem;
    }

    .preset-size {
      color: var(--text-faint);
      font-size: 0.75rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .sides {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: end;
      gap: var(--space-2);
    }

    .swap {
      width: 36px;
      height: 36px;
    }

    .invalid {
      color: var(--danger-text);
    }

    .swatch {
      display: inline-block;
      width: 14px;
      height: 14px;
      margin-right: var(--space-1);
      vertical-align: -2px;
      border: 1px solid var(--line-strong);
      border-radius: 4px;
    }

    .swatch-transparent {
      background: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 / 7px 7px;
    }

    .swatch-white {
      background: white;
    }

    .swatch-black {
      background: black;
    }
  }
</style>
