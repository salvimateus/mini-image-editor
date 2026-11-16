<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import Eraser from '@lucide/svelte/icons/eraser';
  import PaintBucket from '@lucide/svelte/icons/paint-bucket';
  import Scissors from '@lucide/svelte/icons/scissors';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import SquareDashed from '@lucide/svelte/icons/square-dashed';
  import { runAction } from '../../app/actions/index.ts';
  import { untrack } from 'svelte';
  import { getLocale, t } from '../../app/i18n/index.ts';
  import { keyLabels, shortcutOf, type ActionId } from '../../app/shortcuts.ts';
  import { app } from '../../app/state.svelte.ts';
  import { currentSelection, stageDragging } from '../../app/tools/marquee-rect.ts';
  import { transformOn } from '../../app/tools/move.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import Keys from '../base/Keys.svelte';
  import { tooltip } from '../base/tooltip.ts';

  /** A button with no `text` shows only its icon, with the action name and keys in a tooltip. */
  const BUTTONS: readonly { id: ActionId; text?: 'select.bar.copy' | 'select.bar.cut' | 'select.bar.erase' | 'select.bar.fill' | 'select.bar.none'; icon: typeof Eraser }[] = [
    { id: 'edit.copy', text: 'select.bar.copy', icon: Copy },
    { id: 'edit.cut', text: 'select.bar.cut', icon: Scissors },
    { id: 'select.erase', text: 'select.bar.erase', icon: Eraser },
    { id: 'select.fill', text: 'select.bar.fill', icon: PaintBucket },
    { id: 'select.contentFill', icon: Sparkles },
    { id: 'select.none', text: 'select.bar.none', icon: SquareDashed },
  ];

  /**
   * How much the buttons show: labels and keys, labels only, or icons only. The bar takes the first one that fits the
   * stage; the shorter ones keep the action name and keys in a tooltip.
   */
  type Density = 'full' | 'labels' | 'icons';
  const DENSITIES: readonly Density[] = ['full', 'labels', 'icons'];

  let barW = $state(0);
  let barH = $state(0);
  let density = $state<Density>('full');
  /** The bar width (layout px) at each density, measured when it shows; text widths depend on the language. */
  let widths: Partial<Record<Density, number>> = {};
  let widthsLocale = getLocale();
  let lastWidth = 0;
  let bar = $state<HTMLDivElement>();

  $effect(() => {
    const width = barW;
    void app.viewTick;
    const stage = app.stage;
    const locale = getLocale();
    untrack(() => {
      if (locale !== widthsLocale) {
        widthsLocale = locale;
        widths = {};
        lastWidth = 0;
        density = 'full';
        return;
      }
      if (!stage) return;
      // `barW` keeps its last value after the bar unmounts, and lags a density change until the bar is measured again:
      // only a new width of the bar on screen belongs to the density on screen now.
      if (width > 0 && width !== lastWidth && bar?.isConnected) {
        widths[density] = width;
        lastWidth = width;
      }
      const room = stage.viewport.width - 2 * TUNING.select.bar.edgePx;
      const next = DENSITIES.find((option) => (widths[option] ?? 0) <= room) ?? 'icons';
      if (next !== density) density = next;
    });
  });

  const bounds = $derived(app.doc ? (currentSelection(app.doc)?.bounds ?? null) : null);

  /** Under the selection, centered; above it when there is no room below; always inside the stage. */
  const pos = $derived.by(() => {
    void app.viewTick;
    const stage = app.stage;
    const b = bounds;
    if (!stage || !b) return null;
    const { gapPx, edgePx } = TUNING.select.bar;
    const below = stage.docToScreen(b.x + b.w / 2, b.y + b.h);
    const above = stage.docToScreen(b.x + b.w / 2, b.y);
    const { width, height } = stage.viewport;
    let y = below.y + gapPx;
    if (y + barH > height - edgePx) y = above.y - gapPx - barH;
    const x = Math.max(edgePx, Math.min(width - edgePx - barW, below.x - barW / 2));
    y = Math.max(edgePx, Math.min(height - edgePx - barH, y));
    return { x: Math.round(x), y: Math.round(y) };
  });
</script>

{#if pos && !$stageDragging && !$transformOn}
  <div class="selection-bar" role="toolbar" aria-label={t('select.bar')} style:translate="{pos.x}px {pos.y}px" bind:this={bar} bind:offsetWidth={barW} bind:offsetHeight={barH}>
    {#each BUTTONS as button (button.id)}
      {@const Icon = button.icon}
      {@const name = t(shortcutOf(button.id).label)}
      {@const label = button.text && density !== 'icons' ? t(button.text) : null}
      <button
        type="button"
        class="bar-btn"
        class:is-icon={!label}
        aria-label={label ? undefined : name}
        use:tooltip={{ text: label && density === 'full' ? '' : name, keys: keyLabels(button.id) }}
        onclick={() => runAction(button.id, 'pointer')}
      >
        <Icon size={16} strokeWidth={2.25} />
        {#if label}
          <span>{label}</span>
          {#if density === 'full'}<Keys id={button.id} />{/if}
        {/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  @layer components {
    .selection-bar {
      position: absolute;
      top: 0;
      left: 0;
      display: flex;
      gap: var(--space-1);
      padding: var(--space-1);
      background: var(--surface-1);
      border: 2px solid var(--line-strong);
      border-radius: var(--radius-m);
      box-shadow: 0 4px 0 var(--depth);
      font-size: 0.8125rem;
      animation: bar-in var(--dur-pop) var(--ease-spring);
    }

    .bar-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: 32px;
      padding: 0 var(--space-2);
      color: var(--text);
      font: 800 0.8125rem/1 var(--font-display);
      border-radius: var(--radius-s);
      white-space: nowrap;
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover {
        background: var(--surface-3);
      }

      &.is-icon {
        justify-content: center;
        min-width: 32px;
      }

      &:active {
        transform: translateY(1px) scale(0.97);
        transition-duration: 60ms;
      }
    }

    @keyframes bar-in {
      from {
        opacity: 0;
        scale: 0.92;
      }
    }
  }
</style>
