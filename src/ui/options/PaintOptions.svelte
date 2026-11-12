<script lang="ts">
  import { t } from '../../app/i18n/index.ts';
  import { app, type BrushToolId } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import { PARAMS } from '../../core/params/index.ts';
  import { flashBrush } from '../overlays/brush-cursor.ts';
  import SliderField from '../base/SliderField.svelte';

  interface Props {
    /** The brush tool whose settings show; by default the active tool (brush, pencil or eraser). */
    tool?: BrushToolId;
  }

  let { tool }: Props = $props();

  const id = $derived<BrushToolId>(tool ?? (app.tool === 'pencil' || app.tool === 'eraser' || app.tool === 'clone' ? app.tool : 'brush'));
  const settings = $derived(app.brush[id]);
  const defaults = $derived(TUNING.ui.brushDefaults[id]);
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
</script>

<div class="paint-options">
  <div class="option-slider is-size">
    <SliderField
      id="{id}-size"
      label={t('paint.option.size')}
      value={Math.min(maxSize, settings.size)}
      min={TUNING.ui.brushSize.min}
      max={maxSize}
      step={1}
      unit="px"
      reset={defaults.size}
      oninput={setSize}
      onchange={setSize}
    />
  </div>
  {#if id !== 'pencil'}
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
