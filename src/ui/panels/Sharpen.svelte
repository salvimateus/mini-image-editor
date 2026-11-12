<script lang="ts">
  import Minus from '@lucide/svelte/icons/minus';
  import Plus from '@lucide/svelte/icons/plus';
  import { PARAMS } from '../../core/params/index.ts';
  import { intersectRect } from '../../core/raster.ts';
  import type { AdjustOp, Rect, SharpenParams } from '../../core/types.ts';
  import { t } from '../../app/i18n/index.ts';
  import { lastSharpen, saveSharpen } from '../../app/last-used.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import { holdRepeat } from '../base/hold-repeat.ts';
  import SliderField from '../base/SliderField.svelte';
  import AdjustPanel from './AdjustPanel.svelte';

  const limits = PARAMS.adjust.sharpen;
  const tuning = TUNING.adjust.sharpen;
  const DEFAULTS: SharpenParams = { steps: 0, radius: limits.radius.default, threshold: limits.threshold.default };
  const meterSteps = Array.from({ length: limits.maxSteps }, (_, i) => i + 1);

  // The advanced values start from the last applied ones; the steps always start at 0.
  let params = $state<SharpenParams>({ steps: 0, ...lastSharpen() });
  let bump = $state(0);

  const op = $derived<AdjustOp | null>(params.steps === 0 ? null : { kind: 'sharpen', params: { ...params } });
  const canReset = $derived(params.steps !== DEFAULTS.steps || params.radius !== DEFAULTS.radius || params.threshold !== DEFAULTS.threshold);

  // The view after it rests: a pan or zoom asks for a new region only when it pauses.
  let settledTick = $state(app.viewTick);
  $effect(() => {
    const tick = app.viewTick;
    const timer = setTimeout(() => (settledTick = tick), tuning.viewSettleMs);
    return () => clearTimeout(timer);
  });

  /** The part of the active layer on screen, in layer px, cut around its center to the pixel budget. */
  function visibleRegion(): Rect | null {
    const stage = app.stage;
    const layer = app.doc?.active;
    if (!stage || !layer) return null;
    const a = stage.screenToDoc(0, 0);
    const b = stage.screenToDoc(stage.viewport.width, stage.viewport.height);
    const x0 = Math.floor(Math.min(a.x, b.x)) - layer.x;
    const y0 = Math.floor(Math.min(a.y, b.y)) - layer.y;
    const x1 = Math.ceil(Math.max(a.x, b.x)) - layer.x;
    const y1 = Math.ceil(Math.max(a.y, b.y)) - layer.y;
    const seen = intersectRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { x: 0, y: 0, w: layer.image.width, h: layer.image.height });
    if (!seen) return null;
    const area = seen.w * seen.h;
    if (area <= tuning.previewPixels) return seen;
    const scale = Math.sqrt(tuning.previewPixels / area);
    const w = Math.max(1, Math.floor(seen.w * scale));
    const h = Math.max(1, Math.floor(seen.h * scale));
    return { x: seen.x + Math.floor((seen.w - w) / 2), y: seen.y + Math.floor((seen.h - h) / 2), w, h };
  }

  const regionKey = $derived.by(() => {
    void settledTick;
    const rect = visibleRegion();
    return rect ? `${rect.x},${rect.y},${rect.w},${rect.h}` : '';
  });
  const region = $derived.by((): Rect | null => {
    if (!regionKey) return null;
    const [x, y, w, h] = regionKey.split(',').map(Number);
    return { x, y, w, h };
  });

  function stepBy(direction: 1 | -1): void {
    const steps = Math.min(limits.maxSteps, Math.max(0, params.steps + direction));
    if (steps === params.steps) return;
    sfx.play('tick');
    params = { ...params, steps };
    bump += 1;
  }

  function set(patch: Partial<SharpenParams>): void {
    params = { ...params, ...patch };
  }

  function reset(): void {
    params = { ...DEFAULTS };
  }
</script>

<AdjustPanel titleId="panel-sharpen-title" title={t('action.adjust.sharpen')} label="adjust.history.sharpen" {op} {region} {canReset} onreset={reset} onapplied={() => saveSharpen({ radius: params.radius, threshold: params.threshold })}>
  {#snippet children({ disabled })}
    <div class="stepper">
      <button
        type="button"
        class="btn step-btn"
        aria-label={t('adjust.sharpen.less')}
        title={t('adjust.sharpen.less')}
        disabled={disabled || params.steps <= 0}
        use:holdRepeat={{ step: () => stepBy(-1) }}
      >
        <Minus size={20} />
      </button>
      <div class="meter-box">
        <div class="meter" style:grid-template-columns="repeat({limits.maxSteps}, minmax(0, 1fr))" role="meter" aria-label={t('adjust.sharpen.meter')} aria-valuemin={0} aria-valuemax={limits.maxSteps} aria-valuenow={params.steps}>
          {#each meterSteps as n (n)}
            <span class="meter-cell" class:is-on={n <= params.steps} class:is-tip={n === params.steps}></span>
          {/each}
        </div>
        {#key bump}
          <span class="meter-label">{t('adjust.sharpen.level', { n: params.steps, max: limits.maxSteps })}</span>
        {/key}
      </div>
      <button
        type="button"
        class="btn step-btn"
        aria-label={t('adjust.sharpen.more')}
        title={t('adjust.sharpen.more')}
        disabled={disabled || params.steps >= limits.maxSteps}
        use:holdRepeat={{ step: () => stepBy(1) }}
      >
        <Plus size={20} />
      </button>
    </div>
    <p class="hint">{t('adjust.sharpen.regionNote')}</p>
    <details class="advanced">
      <summary class="advanced-summary">{t('adjust.sharpen.advanced')}</summary>
      <div class="advanced-body">
        <SliderField
          id="adjust-sharpen-radius"
          label={t('adjust.sharpen.radius')}
          value={params.radius}
          min={limits.radius.min}
          max={limits.radius.max}
          step={tuning.radiusStep}
          unit="px"
          reset={DEFAULTS.radius}
          {disabled}
          oninput={(radius) => set({ radius })}
          onchange={(radius) => set({ radius })}
        />
        <SliderField
          id="adjust-sharpen-threshold"
          label={t('adjust.sharpen.threshold')}
          value={params.threshold}
          min={limits.threshold.min}
          max={limits.threshold.max}
          step={tuning.thresholdStep}
          reset={DEFAULTS.threshold}
          {disabled}
          oninput={(threshold) => set({ threshold })}
          onchange={(threshold) => set({ threshold })}
        />
      </div>
    </details>
  {/snippet}
</AdjustPanel>

<style>
  @layer components {
    .stepper {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--space-2);
    }

    .step-btn {
      width: 44px;
      min-height: 44px;
      padding: 0;
      border-radius: var(--radius-m);
    }

    .meter-box {
      display: grid;
      justify-items: center;
      gap: var(--space-1);
      min-width: 0;
    }

    .meter {
      display: grid;
      gap: 3px;
      width: 100%;
      height: 18px;
      padding: 3px;
      background: var(--surface-sunken);
      border: 2px solid var(--line);
      border-radius: var(--radius-s);
    }

    .meter-cell {
      background: var(--surface-3);
      border-radius: 3px;
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        transform var(--dur-pop) var(--ease-spring);

      &.is-on {
        background: var(--primary);
      }

      &.is-tip {
        transform: scaleY(1.25);
      }
    }

    .meter-label {
      font: 800 0.8125rem/1 var(--font-display);
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
      animation: meter-pop var(--dur-pop) var(--ease-spring);
    }

    .advanced {
      border-top: 2px solid var(--line);
      padding-top: var(--space-2);
    }

    .advanced-summary {
      color: var(--text-muted);
      font-size: 0.8125rem;
      font-weight: 800;
      cursor: pointer;
      border-radius: var(--radius-s);

      &:hover {
        color: var(--text);
      }

      &:focus-visible {
        outline: 3px solid var(--focus);
        outline-offset: 2px;
      }
    }

    .advanced-body {
      display: grid;
      gap: var(--space-3);
      padding-top: var(--space-3);
    }

    @keyframes meter-pop {
      from {
        transform: scale(1.15);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .meter-cell {
        transition: background-color var(--dur-hover) var(--ease-sym);

        &.is-tip {
          transform: none;
        }
      }

      .meter-label {
        animation: none;
      }
    }
  }
</style>
