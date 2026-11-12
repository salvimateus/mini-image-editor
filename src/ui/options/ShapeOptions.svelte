<script lang="ts">
  import ArrowBigRight from '@lucide/svelte/icons/arrow-big-right';
  import Circle from '@lucide/svelte/icons/circle';
  import MoveRight from '@lucide/svelte/icons/move-right';
  import Square from '@lucide/svelte/icons/square';
  import { t, type TextKey } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';
  import { isArrowKind, SHAPE_KINDS, shapeSettings, type ShapeKindId } from '../../app/tools/shape-settings.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import SliderField from '../base/SliderField.svelte';
  import ToggleSwitch from '../base/ToggleSwitch.svelte';
  import { tooltip } from '../base/tooltip.ts';
  import ColorField from '../panels/ColorField.svelte';

  const KIND_META: Record<ShapeKindId, { label: TextKey; tip: TextKey; icon: typeof Square }> = {
    rect: { label: 'shapes.kind.rect', tip: 'shapes.kind.rectTip', icon: Square },
    ellipse: { label: 'shapes.kind.ellipse', tip: 'shapes.kind.ellipseTip', icon: Circle },
    thin: { label: 'shapes.kind.thin', tip: 'shapes.kind.thinTip', icon: MoveRight },
    thick: { label: 'shapes.kind.thick', tip: 'shapes.kind.thickTip', icon: ArrowBigRight },
  };
  const R = TUNING.shapes.ranges;
  const D = TUNING.shapes.defaults;

  const settings = $derived(shapeSettings.value);
  const kind = $derived(settings.kind);
  const arrow = $derived(isArrowKind(kind));
  /** The active shape that these options edit, or null: they then set the next shape. */
  const spec = $derived(shapeSettings.activeFor('shape')?.spec ?? null);

  const stroke = $derived(spec ? spec.stroke : arrow ? settings.arrow.stroke : settings.box.stroke);
  const fillOn = $derived(spec && (spec.kind === 'rect' || spec.kind === 'ellipse') ? spec.fill !== null : settings.box.fillOn);
  const fillColor = $derived(spec && (spec.kind === 'rect' || spec.kind === 'ellipse') && spec.fill ? spec.fill : settings.box.fill);
  const radius = $derived(spec?.kind === 'rect' ? spec.radius : settings.box.radius);
  const arrowColor = $derived(spec?.kind === 'arrow' ? spec.fill : settings.arrow.color);
  const arrowSize = $derived(spec?.kind === 'arrow' ? spec.size : kind === 'thin' ? settings.arrow.thinSize : settings.arrow.thickSize);
  const sizeRange = $derived(kind === 'thin' ? R.thinSize : R.thickSize);

  function setKind(next: ShapeKindId): void {
    if (next === kind) return;
    sfx.play('tick');
    shapeSettings.setKind(next);
  }
</script>

<div class="shape-options">
  <div class="segmented shape-kinds" role="group" aria-label={t('shapes.kind')}>
    {#each SHAPE_KINDS as id (id)}
      {@const meta = KIND_META[id]}
      {@const Icon = meta.icon}
      <button type="button" aria-pressed={kind === id} aria-label={t(meta.label)} use:tooltip={{ text: t(meta.tip) }} onclick={() => setKind(id)}>
        <Icon size={17} strokeWidth={2.25} />
      </button>
    {/each}
  </div>

  {#if arrow}
    <div class="shape-color" use:tooltip={{ text: t('shapes.arrowColor') }}>
      <ColorField id="shape-arrow-color" label={t('shapes.arrowColor')} color={arrowColor} onchange={(color) => shapeSettings.setArrowColor(color)} />
    </div>
    <div class="shape-slider">
      <SliderField
        id="shape-arrow-size"
        label={t('shapes.arrowSize')}
        value={arrowSize}
        min={sizeRange.min}
        max={sizeRange.max}
        step={sizeRange.step}
        unit="px"
        reset={kind === 'thin' ? D.arrow.thinSize : D.arrow.thickSize}
        oninput={(value) => shapeSettings.setArrowSize(value, 'arrow-size')}
        onchange={(value) => shapeSettings.setArrowSize(value, 'arrow-size')}
      />
    </div>
  {/if}

  <div class="shape-color" use:tooltip={{ text: t('shapes.strokeColor') }}>
    <ColorField id="shape-stroke-color" label={t('shapes.strokeColor')} color={stroke.color} onchange={(color) => shapeSettings.setStroke({ color })} />
  </div>
  <div class="shape-slider">
    <SliderField
      id="shape-stroke-width"
      label={t('shapes.stroke')}
      value={stroke.width}
      min={R.strokeWidth.min}
      max={R.strokeWidth.max}
      step={R.strokeWidth.step}
      unit="px"
      reset={arrow ? D.arrow.strokeWidth : D.box.strokeWidth}
      oninput={(width) => shapeSettings.setStroke({ width }, 'stroke-width')}
      onchange={(width) => shapeSettings.setStroke({ width }, 'stroke-width')}
    />
  </div>

  {#if !arrow}
    <ToggleSwitch id="shape-fill-on" label={t('shapes.fill')} hint={t('shapes.fillHint')} checked={fillOn} onchange={(on) => shapeSettings.setFillOn(on)} />
    {#if fillOn}
      <div class="shape-color" use:tooltip={{ text: t('shapes.fillColor') }}>
        <ColorField id="shape-fill-color" label={t('shapes.fillColor')} color={fillColor} onchange={(color) => shapeSettings.setFillColor(color)} />
      </div>
    {/if}
  {/if}

  {#if kind === 'rect'}
    <div class="shape-slider is-wide">
      <SliderField
        id="shape-radius"
        label={t('shapes.radius')}
        value={radius}
        min={R.radius.min}
        max={R.radius.max}
        step={R.radius.step}
        unit="px"
        reset={D.box.radius}
        oninput={(value) => shapeSettings.setRadius(value, 'radius')}
        onchange={(value) => shapeSettings.setRadius(value, 'radius')}
      />
    </div>
  {/if}
</div>

<style>
  @layer components {
    .shape-options {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;

      & > :global(*) {
        flex: none;
      }
    }


    .shape-kinds button {
      display: inline-grid;
      place-items: center;
      width: 34px;
      padding: 0;
    }

    /* Only the swatch: the label shows as a tooltip and stays the accessible name. */
    .shape-color {
      width: 44px;

      & :global(.color-field-text) {
        display: none;
      }

      & :global(.color-field-btn) {
        min-height: 34px;
        padding: 2px;
      }
    }

    .shape-slider {
      width: 226px;

      & :global(.slider-number) {
        width: 3rem;
      }

      &.is-wide {
        width: 262px;
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
