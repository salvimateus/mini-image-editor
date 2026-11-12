<script lang="ts">
  import SquareMinus from '@lucide/svelte/icons/square-minus';
  import SquarePlus from '@lucide/svelte/icons/square-plus';
  import SquareDashed from '@lucide/svelte/icons/square-dashed';
  import SquaresIntersect from '@lucide/svelte/icons/squares-intersect';
  import type { MaskOp } from '../../core/mask.ts';
  import { t, type TextKey } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app } from '../../app/state.svelte.ts';
  import { SELECT_MODES, selectSettings, setSelectSettings } from '../../app/tools/marquee-rect.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import ToggleSwitch from '../base/ToggleSwitch.svelte';
  import { tooltip } from '../base/tooltip.ts';

  const MODE_META: Record<MaskOp, { label: TextKey; tip: TextKey; keys: string[]; icon: typeof SquarePlus }> = {
    replace: { label: 'select.mode.replace', tip: 'select.mode.replaceTip', keys: [], icon: SquareDashed },
    add: { label: 'select.mode.add', tip: 'select.mode.addTip', keys: ['Shift'], icon: SquarePlus },
    subtract: { label: 'select.mode.subtract', tip: 'select.mode.subtractTip', keys: ['Alt'], icon: SquareMinus },
    intersect: { label: 'select.mode.intersect', tip: 'select.mode.intersectTip', keys: ['Shift', 'Alt'], icon: SquaresIntersect },
  };

  function setMode(mode: MaskOp): void {
    if ($selectSettings.mode === mode) return;
    sfx.play('tick');
    setSelectSettings({ mode });
  }

  function onRange(key: 'feather' | 'tolerance', event: Event): void {
    sfx.play('tick');
    setSelectSettings({ [key]: Number((event.currentTarget as HTMLInputElement).value) });
  }
</script>

<div class="segmented select-modes" role="group" aria-label={t('select.mode')}>
  {#each SELECT_MODES as mode (mode)}
    {@const meta = MODE_META[mode]}
    {@const Icon = meta.icon}
    <button type="button" aria-pressed={$selectSettings.mode === mode} use:tooltip={{ text: t(meta.tip), keys: meta.keys }} onclick={() => setMode(mode)}>
      <Icon size={15} strokeWidth={2.25} />
      <span>{t(meta.label)}</span>
    </button>
  {/each}
</div>

<label class="compact-range" for="select-feather">
  <span class="compact-label">{t('select.feather')}</span>
  <input
    id="select-feather"
    name="select-feather"
    class="range-input"
    type="range"
    min="0"
    max={TUNING.select.featherMax}
    step="1"
    value={$selectSettings.feather}
    oninput={(event) => onRange('feather', event)}
  />
  <output class="compact-value" for="select-feather">{$selectSettings.feather} px</output>
</label>

{#if app.tool === 'wand'}
  <label class="compact-range" for="select-tolerance">
    <span class="compact-label">{t('select.tolerance')}</span>
    <input
      id="select-tolerance"
      name="select-tolerance"
      class="range-input"
      type="range"
      min="0"
      max="255"
      step="1"
      value={$selectSettings.tolerance}
      oninput={(event) => onRange('tolerance', event)}
    />
    <output class="compact-value" for="select-tolerance">{$selectSettings.tolerance}</output>
  </label>
  <ToggleSwitch
    id="select-contiguous"
    label={t('select.contiguous')}
    hint={t('select.contiguousHint')}
    checked={$selectSettings.contiguous}
    onchange={(checked) => setSelectSettings({ contiguous: checked })}
  />
{/if}

<style>
  @layer components {
    .select-modes {
      flex: none;

      & button {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
      }
    }

    .compact-range {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: var(--space-2);

      & .range-input {
        width: 7rem;
      }
    }

    .compact-label {
      color: var(--text-muted);
      font-size: 0.8125rem;
      font-weight: 700;
      white-space: nowrap;
    }

    .compact-value {
      min-width: 3.25rem;
      font-size: 0.8125rem;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
  }
</style>
