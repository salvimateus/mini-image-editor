<script lang="ts">
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import { parseDecimal, t } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app } from '../../app/state.svelte.ts';
  import { shapeSettings } from '../../app/tools/shape-settings.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import SliderField from '../base/SliderField.svelte';
  import ToggleSwitch from '../base/ToggleSwitch.svelte';
  import { tooltip } from '../base/tooltip.ts';
  import ColorField from '../panels/ColorField.svelte';

  const R = TUNING.shapes.ranges;
  const D = TUNING.shapes.defaults.step;

  const settings = $derived(shapeSettings.value.step);
  /** The active step that these options edit, or null: they then set the next step. */
  const spec = $derived.by(() => {
    const value = shapeSettings.activeFor('step')?.spec;
    return value?.kind === 'step' ? value : null;
  });
  const size = $derived(spec?.size ?? settings.size);
  const fill = $derived(spec?.fill ?? settings.fill);
  const textColor = $derived(spec?.textColor ?? settings.textColor);
  const stroke = $derived(spec?.stroke ?? settings.stroke);
  // A step with no shadow field has the shadow.
  const shadow = $derived(spec ? spec.shadow !== false : settings.shadow);
  // The layers are read so that an undo or a new step updates the next number.
  const next = $derived.by(() => {
    void app.doc?.layers;
    return shapeSettings.nextNumber();
  });

  let draft = $state<string | null>(null);

  function setNumber(value: number): void {
    draft = null;
    if (value === next) return;
    sfx.play('tick');
    shapeSettings.setNextNumber(value);
  }

  function commitDraft(): void {
    if (draft === null) return;
    const parsed = parseDecimal(draft);
    if (parsed === null) {
      draft = null;
      return;
    }
    setNumber(Math.round(parsed));
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDraft();
    } else if (event.key === 'Escape' && draft !== null) {
      event.preventDefault();
      event.stopPropagation();
      draft = null;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const range = R.stepNumber;
      setNumber(Math.min(range.max, Math.max(range.min, next + (event.key === 'ArrowUp' ? 1 : -1))));
    }
  }

  function restart(): void {
    draft = null;
    sfx.play('tick');
    shapeSettings.restartNumbers();
  }
</script>

<div class="step-options">
  <div class="step-slider">
    <SliderField
      id="step-size"
      label={t('steps.size')}
      value={size}
      min={R.stepSize.min}
      max={R.stepSize.max}
      step={R.stepSize.step}
      unit="px"
      reset={D.size}
      oninput={(value) => shapeSettings.setStep({ size: value }, 'step-size')}
      onchange={(value) => shapeSettings.setStep({ size: value }, 'step-size')}
    />
  </div>
  <div class="step-color" use:tooltip={{ text: t('steps.fill') }}>
    <ColorField id="step-fill" label={t('steps.fill')} color={fill} onchange={(color) => shapeSettings.setStep({ fill: color })} />
  </div>
  <div class="step-color" use:tooltip={{ text: t('steps.textColor') }}>
    <ColorField id="step-text-color" label={t('steps.textColor')} color={textColor} onchange={(color) => shapeSettings.setStep({ textColor: color })} />
  </div>
  <div class="step-color" use:tooltip={{ text: t('steps.strokeColor') }}>
    <ColorField id="step-stroke-color" label={t('steps.strokeColor')} color={stroke.color} onchange={(color) => shapeSettings.setStep({ stroke: { color } })} />
  </div>
  <div class="step-slider">
    <SliderField
      id="step-stroke"
      label={t('steps.stroke')}
      value={stroke.width}
      min={R.stepStroke.min}
      max={R.stepStroke.max}
      step={R.stepStroke.step}
      unit="px"
      reset={D.strokeWidth}
      oninput={(width) => shapeSettings.setStep({ stroke: { width } }, 'step-stroke')}
      onchange={(width) => shapeSettings.setStep({ stroke: { width } }, 'step-stroke')}
    />
  </div>
  <ToggleSwitch id="step-shadow" label={t('steps.shadow')} hint={t('steps.shadowHint')} checked={shadow} onchange={(on) => shapeSettings.setStep({ shadow: on })} />
  <label class="step-number" use:tooltip={{ text: t('steps.numberHint') }}>
    <span class="step-label">{t('steps.number')}</span>
    <input
      id="step-next"
      name="step-next"
      class="number-input"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      spellcheck="false"
      value={draft ?? String(next)}
      oninput={(event) => (draft = event.currentTarget.value)}
      onkeydown={onKey}
      onblur={commitDraft}
    />
  </label>
  <button type="button" class="btn btn-small step-restart" use:tooltip={{ text: t('steps.restartTip') }} onclick={restart}>
    <RotateCcw size={15} strokeWidth={2.25} aria-hidden="true" />
    {t('steps.restart')}
  </button>
</div>

<style>
  @layer components {
    .step-options {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;

      & > :global(*) {
        flex: none;
      }
    }


    /* Only the swatch: the label shows as a tooltip and stays the accessible name. */
    .step-color {
      width: 44px;

      & :global(.color-field-text) {
        display: none;
      }

      & :global(.color-field-btn) {
        min-height: 34px;
        padding: 2px;
      }
    }

    .step-slider {
      width: 226px;

      & :global(.slider-number) {
        width: 3rem;
      }

      & :global(.slider-field) {
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        column-gap: var(--space-2);
      }
    }

    .step-number {
      display: inline-flex;
      align-items: center;
      gap: 6px;

      & .number-input {
        width: 3.5rem;
        min-height: 32px;
      }
    }

    .step-label {
      color: var(--text-muted);
      font-size: 0.8125rem;
      font-weight: 700;
      white-space: nowrap;
    }

    .step-restart {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      white-space: nowrap;
    }
  }
</style>
