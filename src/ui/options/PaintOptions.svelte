<script lang="ts">
  import Circle from '@lucide/svelte/icons/circle';
  import Square from '@lucide/svelte/icons/square';
  import type { TipShape } from '../../core/brush-tip.ts';
  import { t, type TextKey } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app, SHAPED_BRUSHES, type BrushToolId } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import { PARAMS } from '../../core/params/index.ts';
  import { flashBrush } from '../overlays/brush-cursor.ts';
  import SliderField from '../base/SliderField.svelte';
  import { tooltip } from '../base/tooltip.ts';

  const SHAPE_META: { shape: TipShape; label: TextKey; tip: TextKey; icon: typeof Square }[] = [
    { shape: 'round', label: 'paint.option.tipRound', tip: 'paint.option.tipRoundTip', icon: Circle },
    { shape: 'square', label: 'paint.option.tipSquare', tip: 'paint.option.tipSquareTip', icon: Square },
  ];

  interface Props {
    /** The brush tool whose settings show; by default the active tool (brush, pen or eraser). */
    tool?: BrushToolId;
  }

  let { tool }: Props = $props();

  const id = $derived<BrushToolId>(tool ?? (app.tool === 'pencil' || app.tool === 'eraser' || app.tool === 'clone' ? app.tool : 'brush'));
  const settings = $derived(app.brush[id]);
  const defaults = $derived(TUNING.ui.brushDefaults[id]);
  /** The pencil tool resets the size to the start size of its preset. */
  const resetSize = $derived(id === 'sketch' ? TUNING.ui.brushDefaults.sketch.sizes[app.brush.sketch.preset] : defaults.size);
  const maxSize = PARAMS.paint.maxSize;

  function setSize(value: number): void {
    const next = app.setBrush(id, { size: Math.min(maxSize, value) });
    flashBrush(t('paint.flash.size', { size: next.size }));
  }

  function setHardness(value: number): void {
    const next = app.setBrush(id, { hardness: value / 100 });
    flashBrush(t('paint.flash.hardness', { value: Math.round(next.hardness * 100) }));
  }

  function setOpacity(value: number): void {
    app.setBrush(id, { opacity: value / 100 });
  }

  function setShape(shape: TipShape): void {
    if (settings.shape === shape) return;
    sfx.play('tick');
    app.setBrush(id, { shape });
    app.stage?.invalidateFx();
  }
</script>

<div class="paint-options">
  {#if SHAPED_BRUSHES.has(id)}
    <div class="segmented tip-shapes" role="group" aria-label={t('paint.option.tip')}>
      {#each SHAPE_META as meta (meta.shape)}
        {@const Icon = meta.icon}
        <button
          type="button"
          aria-pressed={settings.shape === meta.shape}
          aria-label={t(meta.label)}
          use:tooltip={{ text: t(meta.tip) }}
          onclick={() => setShape(meta.shape)}
        >
          <Icon size={17} strokeWidth={2.25} />
        </button>
      {/each}
    </div>
  {/if}
  <div class="option-slider is-size">
    <SliderField
      id="{id}-size"
      label={t('paint.option.size')}
      value={Math.min(maxSize, settings.size)}
      min={TUNING.ui.brushSize.min}
      max={maxSize}
      step={1}
      unit="px"
      reset={resetSize}
      oninput={setSize}
      onchange={setSize}
    />
  </div>
  {#if id !== 'pencil' && id !== 'sketch'}
    <div class="option-slider">
      <SliderField
        id="{id}-hardness"
        label={t('paint.option.hardness')}
        value={Math.round(settings.hardness * 100)}
        min={0}
        max={100}
        step={1}
        unit="%"
        reset={Math.round(defaults.hardness * 100)}
        oninput={setHardness}
        onchange={setHardness}
      />
    </div>
  {/if}
  <div class="option-slider">
    <SliderField
      id="{id}-opacity"
      label={t('paint.option.opacity')}
      value={Math.round(settings.opacity * 100)}
      min={1}
      max={100}
      step={1}
      unit="%"
      reset={Math.round(defaults.opacity * 100)}
      oninput={setOpacity}
      onchange={setOpacity}
    />
  </div>
</div>

<style>
  @layer components {
    .paint-options {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      min-width: 0;
    }

    .tip-shapes {
      flex: none;

      & button {
        display: inline-grid;
        place-items: center;
        width: 34px;
        padding: 0;
      }
    }

    .option-slider {
      flex: none;
      width: 270px;

      &.is-size {
        width: 300px;
      }

      /* One row in the options bar: label and number, then the range. */
      & :global(.slider-field) {
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        column-gap: var(--space-2);
      }
    }
  }
</style>
