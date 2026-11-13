<script lang="ts">
  import CircleUserRound from '@lucide/svelte/icons/circle-user-round';
  import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
  import Magnet from '@lucide/svelte/icons/magnet';
  import Ruler from '@lucide/svelte/icons/ruler';
  import ScanLine from '@lucide/svelte/icons/scan-line';
  import { FORMAT_INFO } from '../core/formats.ts';
  import { actionChecked, runAction } from '../app/actions/index.ts';
  import { ratioLabel } from '../app/aspect.ts';
  import { app } from '../app/state.svelte.ts';
  import { formatBytes, t } from '../app/i18n/index.ts';
  import { keyLabels, shortcutOf, type ActionId } from '../app/shortcuts.ts';
  import * as sfx from '../app/sfx.ts';
  import { TUNING } from '../app/tuning/index.ts';
  import { tooltip } from './base/tooltip.ts';
  import AspectBar from './AspectBar.svelte';

  type IconType = typeof Ruler;

  const TOGGLES: readonly { id: ActionId; icon: IconType }[] = [
    { id: 'view.rulers', icon: Ruler },
    { id: 'view.guides', icon: ScanLine },
    { id: 'view.grid', icon: Grid3x3 },
    { id: 'view.snap', icon: Magnet },
    { id: 'view.avatar', icon: CircleUserRound },
  ];

  const doc = $derived(app.doc);
  const ratio = $derived(doc ? ratioLabel(doc.width, doc.height) : { text: '', preset: null });
  const zoomPct = $derived(Math.round(app.zoom * 100));
  const formatLabel = $derived(FORMAT_INFO[app.lastFormat].label);
  const weightUpper = $derived(app.weight.upper === true && app.weight.bytes !== null);
  const weightTip = $derived(
    weightUpper ? t('chrome.status.weightUpperTip', { format: formatLabel }) : t('chrome.status.weight', { format: formatLabel }),
  );

  let zoomOpen = $state(false);
  let zoomBox = $state<HTMLDivElement>();

  function setZoom(scale: number | 'fit'): void {
    zoomOpen = false;
    sfx.play('tick');
    if (scale === 'fit') app.stage?.fitView();
    else app.stage?.zoomTo(scale);
  }

  function onWindowPointer(event: PointerEvent): void {
    if (zoomOpen && !zoomBox?.contains(event.target as Node)) zoomOpen = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onblur={() => (zoomOpen = false)} />

<footer class="status" aria-label={t('chrome.status')}>
  {#if doc}
    <span class="cell size">{t('chrome.status.size', { w: doc.width, h: doc.height })}</span>

    <span class="cell ratio">
      {#key ratio.text}
        <span class="ratio-text" use:tooltip={{ text: t('chrome.status.ratio') }}>{ratio.text}</span>
      {/key}
      <AspectBar active={ratio.preset} />
    </span>

    <div class="cell zoom" bind:this={zoomBox}>
      <button
        type="button"
        class="chip"
        aria-haspopup="menu"
        aria-expanded={zoomOpen}
        aria-label={t('chrome.status.zoom', { pct: zoomPct })}
        onclick={() => {
          sfx.play('tick');
          zoomOpen = !zoomOpen;
        }}
        onkeydown={(event) => {
          if (event.key === 'Escape' && zoomOpen) {
            event.stopPropagation();
            zoomOpen = false;
          }
        }}
      >
        {zoomPct}%
      </button>
      {#if zoomOpen}
        <div class="popup" role="menu">
          <button type="button" class="popup-row" role="menuitem" onclick={() => setZoom('fit')}>{t('chrome.status.fit')}</button>
          {#each TUNING.ui.zoomPresets as scale (scale)}
            <button type="button" class="popup-row" class:is-active={Math.abs(app.zoom - scale) < 0.001} role="menuitem" onclick={() => setZoom(scale)}>
              {Math.round(scale * 100)}%
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <span class="cell weight" use:tooltip={{ text: weightTip }}>
      <span class="weight-format">{formatLabel}</span>
      <span class="weight-slot">
        {#if weightUpper && app.weight.bytes !== null}
          <span class="weight-upper">
            {t('chrome.status.weightUpper', { size: formatBytes(app.weight.bytes) })}
            <span class="weight-working" aria-hidden="true"></span>
          </span>
        {:else if app.weight.pending}
          <span class="weight-pending">{t('chrome.status.weightPending')}</span>
        {:else if app.weight.bytes !== null}
          {#key app.weight.bytes}<span class="weight-value">{formatBytes(app.weight.bytes)}</span>{/key}
        {:else}
          <span class="weight-pending">{t('chrome.status.weightNone')}</span>
        {/if}
      </span>
    </span>

    <span class="spacer"></span>

    <div class="toggles">
      {#each TOGGLES as toggle (toggle.id)}
        {@const Icon = toggle.icon}
        {@const label = t(shortcutOf(toggle.id).label)}
        <button
          type="button"
          class="toggle"
          aria-pressed={actionChecked(toggle.id) ?? false}
          aria-label={label}
          use:tooltip={{ text: label, keys: keyLabels(toggle.id) }}
          onclick={() => runAction(toggle.id, 'pointer')}
        >
          <Icon size={16} strokeWidth={2.25} />
        </button>
      {/each}
    </div>
  {/if}
</footer>

<style>
  @layer components {
    .status {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      height: var(--status-h);
      padding: 0 var(--space-3);
      background: var(--surface-1);
      border-top: 2px solid var(--line);
      font-size: 0.8125rem;
      font-weight: 700;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .cell {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: var(--space-2);
      font-variant-numeric: tabular-nums;

      & + & {
        padding-left: var(--space-3);
        border-left: 2px solid var(--line);
      }
    }

    .size {
      color: var(--text);
      font-weight: 800;
    }

    .ratio-text {
      min-width: 3.5em;
      color: var(--text);
      font-weight: 800;
      animation: value-pop var(--dur-pop) var(--ease-spring);
    }

    .zoom {
      position: relative;
    }

    .chip {
      height: 22px;
      min-width: 52px;
      padding: 0 var(--space-2);
      background: var(--surface-2);
      border: 1px solid var(--line);
      border-radius: var(--radius-pill);
      font: 800 0.75rem/1 var(--font-display);
      font-variant-numeric: tabular-nums;
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover {
        background: var(--surface-3);
      }

      &:active {
        transform: scale(0.95);
      }
    }

    .popup {
      bottom: calc(100% + 8px);
      left: 0;
      min-width: 140px;
      transform-origin: bottom left;
    }

    .weight-format {
      padding: 1px 6px;
      color: var(--text-faint);
      background: var(--surface-sunken);
      border-radius: var(--radius-s);
      font-size: 0.6875rem;
      font-weight: 800;
    }

    .weight-value {
      color: var(--text);
      animation: value-pop var(--dur-pop) var(--ease-spring);
    }

    /* One width for every state, so the cells after it do not jump. */
    .weight-slot {
      display: inline-flex;
      align-items: center;
      min-width: 8.5em;
    }

    .weight-upper {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--text-muted);
    }

    .weight-working {
      width: 6px;
      height: 6px;
      background: var(--primary);
      border-radius: var(--radius-pill);
      animation: weight-breathe 1.6s var(--ease-sym) infinite alternate;
    }

    @keyframes weight-breathe {
      from {
        opacity: 0.25;
        scale: 0.7;
      }
      to {
        opacity: 0.9;
        scale: 1;
      }
    }

    .weight-pending {
      color: var(--text-faint);
    }

    .spacer {
      flex: 1;
    }

    .toggles {
      display: flex;
      gap: 2px;
    }

    .toggle {
      display: grid;
      place-items: center;
      width: 26px;
      height: 24px;
      color: var(--text-faint);
      border-radius: var(--radius-s);
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        color var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover {
        color: var(--text);
        background: var(--surface-3);
      }

      &:active {
        transform: scale(0.88);
        transition-duration: 60ms;
      }

      &[aria-pressed='true'] {
        color: var(--on-primary);
        background: var(--primary);
      }
    }

    /* A narrow window: tighter cells, and the format name moves to the tooltip of the weight. */
    @media (max-width: 1180px) {
      .status {
        gap: var(--space-2);
        padding: 0 var(--space-2);
      }

      .cell + .cell {
        padding-left: var(--space-2);
      }

      .weight-format {
        display: none;
      }
    }

    @keyframes value-pop {
      from {
        opacity: 0.4;
        scale: 0.9;
      }
    }
  }
</style>
