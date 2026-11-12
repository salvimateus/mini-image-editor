<script lang="ts">
  import { HUE_SATURATION_IDENTITY, hueSaturationMap, isHueSaturationIdentity } from '../../core/adjust/index.ts';
  import type { AdjustOp, HueSaturationParams } from '../../core/types.ts';
  import { t } from '../../app/i18n/index.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import SliderField from '../base/SliderField.svelte';
  import ToggleSwitch from '../base/ToggleSwitch.svelte';
  import AdjustPanel from './AdjustPanel.svelte';

  const ranges = TUNING.adjust.hueSaturation;

  let params = $state<HueSaturationParams>({ ...HUE_SATURATION_IDENTITY });

  const identity = $derived(isHueSaturationIdentity(params));
  const op = $derived<AdjustOp | null>(identity ? null : { kind: 'hue-saturation', params: { ...params } });

  /** A CSS gradient of the full hue circle at full saturation, mapped through `map`. */
  function strip(map: ((r: number, g: number, b: number, out: Float64Array) => void) | null): string {
    const stops: string[] = [];
    const out = new Float64Array(3);
    const count = ranges.stripStops;
    for (let i = 0; i < count; i++) {
      const hue = (i / (count - 1)) * 360;
      const [r, g, b] = hueColor(hue);
      if (map) map(r, g, b, out);
      else out.set([r, g, b]);
      const css = `rgb(${Math.round(clampByte(out[0]))} ${Math.round(clampByte(out[1]))} ${Math.round(clampByte(out[2]))})`;
      stops.push(`${css} ${((i / (count - 1)) * 100).toFixed(2)}%`);
    }
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }

  function clampByte(value: number): number {
    return Math.min(255, Math.max(0, value));
  }

  /** The pure color of a hue (HSV with full saturation and value), 0..255. */
  function hueColor(hue: number): [number, number, number] {
    const f = (n: number) => {
      const k = (n + hue / 60) % 6;
      return 255 * (1 - Math.max(0, Math.min(k, 4 - k, 1)));
    };
    return [f(5), f(3), f(1)];
  }

  const inputStrip = strip(null);
  const outputStrip = $derived(strip(hueSaturationMap(params)));

  function set(patch: Partial<HueSaturationParams>): void {
    params = { ...params, ...patch };
  }

  function reset(): void {
    params = { ...HUE_SATURATION_IDENTITY };
  }
</script>

<AdjustPanel titleId="panel-hue-title" title={t('action.adjust.hueSaturation')} label="adjust.history.hueSaturation" {op} canReset={!identity} onreset={reset}>
  {#snippet children({ disabled })}
    <SliderField
      id="adjust-hue"
      label={t('adjust.hue')}
      value={params.hue}
      min={ranges.hue.min}
      max={ranges.hue.max}
      step={ranges.hue.step}
      unit="°"
      reset={0}
      {disabled}
      oninput={(hue) => set({ hue })}
      onchange={(hue) => set({ hue })}
    />
    <SliderField
      id="adjust-saturation"
      label={t('adjust.saturation')}
      value={params.saturation}
      min={ranges.saturation.min}
      max={ranges.saturation.max}
      step={ranges.saturation.step}
      reset={0}
      {disabled}
      oninput={(saturation) => set({ saturation })}
      onchange={(saturation) => set({ saturation })}
    />
    <SliderField
      id="adjust-lightness"
      label={t('adjust.lightness')}
      value={params.lightness}
      min={ranges.lightness.min}
      max={ranges.lightness.max}
      step={ranges.lightness.step}
      reset={0}
      {disabled}
      oninput={(lightness) => set({ lightness })}
      onchange={(lightness) => set({ lightness })}
    />
    <ToggleSwitch id="adjust-colorize" label={t('adjust.colorize')} hint={t('adjust.colorizeHint')} checked={params.colorize} {disabled} onchange={(colorize) => set({ colorize })} />
    <div class="strips">
      <span class="strip" role="img" aria-label={t('adjust.stripIn')} title={t('adjust.stripIn')} style:background-image={inputStrip}></span>
      <span class="strip is-result" role="img" aria-label={t('adjust.stripOut')} title={t('adjust.stripOut')} style:background-image={outputStrip}></span>
    </div>
  {/snippet}
</AdjustPanel>

<style>
  @layer components {
    .strips {
      display: grid;
      gap: 3px;
      padding: 3px;
      background: var(--surface-sunken);
      border: 2px solid var(--line);
      border-radius: var(--radius-s);
    }

    .strip {
      display: block;
      height: 12px;
      border-radius: 4px;

      &.is-result {
        height: 16px;
      }
    }
  }
</style>
