<script lang="ts">
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import { presetLabel, RATIO_PRESETS, type RatioPreset } from '../app/aspect.ts';
  import { app } from '../app/state.svelte.ts';
  import { t } from '../app/i18n/index.ts';
  import * as sfx from '../app/sfx.ts';
  import { tooltip } from './base/tooltip.ts';

  interface Props {
    /** The id of the preset that matches the stage now (exact or near). */
    active: string | null;
  }

  let { active }: Props = $props();

  const MAIN = RATIO_PRESETS.filter((preset) => preset.main);
  const MORE = RATIO_PRESETS.filter((preset) => !preset.main);

  let moreOpen = $state(false);
  let moreBox: HTMLDivElement;
  const moreActive = $derived(MORE.some((preset) => preset.id === active));

  function pick(preset: RatioPreset): void {
    moreOpen = false;
    // From another tool, the switch to Crop plays its own sound.
    if (app.tool === 'crop') sfx.play('tick');
    app.requestCrop(preset.w, preset.h);
  }

  function onWindowPointer(event: PointerEvent): void {
    if (moreOpen && !moreBox.contains(event.target as Node)) moreOpen = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onblur={() => (moreOpen = false)} />

<div class="aspect" role="group" aria-label={t('chrome.aspect.presets')}>
  {#each MAIN as preset (preset.id)}
    <button
      type="button"
      class="ratio"
      class:is-active={active === preset.id}
      aria-pressed={active === preset.id}
      use:tooltip={{ text: t('chrome.aspect.crop', { ratio: presetLabel(preset) }) }}
      onclick={() => pick(preset)}
    >
      {presetLabel(preset)}
    </button>
  {/each}
  <div class="more" bind:this={moreBox}>
    <button
      type="button"
      class="ratio"
      class:is-active={moreActive}
      aria-haspopup="menu"
      aria-expanded={moreOpen}
      aria-label={t('chrome.aspect.moreLabel')}
      onclick={() => {
        sfx.play('tick');
        moreOpen = !moreOpen;
      }}
      onkeydown={(event) => {
        if (event.key === 'Escape' && moreOpen) {
          event.stopPropagation();
          moreOpen = false;
        }
      }}
    >
      {t('chrome.aspect.more')}
      <ChevronUp size={13} strokeWidth={3} />
    </button>
    {#if moreOpen}
      <div class="popup" role="menu">
        {#each MORE as preset (preset.id)}
          <button type="button" class="popup-row" class:is-active={active === preset.id} role="menuitem" onclick={() => pick(preset)}>
            {presetLabel(preset)}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  @layer components {
    .aspect {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .ratio {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      height: 22px;
      padding: 0 6px;
      color: var(--text-faint);
      border-radius: var(--radius-s);
      font: 800 0.75rem/1 var(--font-display);
      font-variant-numeric: tabular-nums;
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        color var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover {
        color: var(--text);
        background: var(--surface-3);
        transform: translateY(-1px);
      }

      &:active {
        transform: translateY(1px) scale(0.95);
        transition-duration: 60ms;
      }

      &.is-active {
        color: var(--on-primary);
        background: var(--primary);
      }
    }

    .more {
      position: relative;
    }

    @media (max-width: 1180px) {
      .ratio {
        padding: 0 4px;
      }
    }

    .popup {
      bottom: calc(100% + 8px);
      left: 0;
      min-width: 96px;
      transform-origin: bottom left;
    }

    .popup-row {
      font-variant-numeric: tabular-nums;
    }
  }
</style>
