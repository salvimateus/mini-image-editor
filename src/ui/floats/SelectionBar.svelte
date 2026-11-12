<script lang="ts">
  import Eraser from '@lucide/svelte/icons/eraser';
  import PaintBucket from '@lucide/svelte/icons/paint-bucket';
  import SquareDashed from '@lucide/svelte/icons/square-dashed';
  import { runAction } from '../../app/actions/index.ts';
  import { t } from '../../app/i18n/index.ts';
  import type { ActionId } from '../../app/shortcuts.ts';
  import { app } from '../../app/state.svelte.ts';
  import { currentSelection, stageDragging } from '../../app/tools/marquee-rect.ts';
  import { transformOn } from '../../app/tools/move.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import Keys from '../base/Keys.svelte';

  const BUTTONS: readonly { id: ActionId; text: 'select.bar.erase' | 'select.bar.fill' | 'select.bar.none'; icon: typeof Eraser }[] = [
    { id: 'select.erase', text: 'select.bar.erase', icon: Eraser },
    { id: 'select.fill', text: 'select.bar.fill', icon: PaintBucket },
    { id: 'select.none', text: 'select.bar.none', icon: SquareDashed },
  ];

  let barW = $state(0);
  let barH = $state(0);

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
  <div class="selection-bar" role="toolbar" aria-label={t('select.bar')} style:translate="{pos.x}px {pos.y}px" bind:offsetWidth={barW} bind:offsetHeight={barH}>
    {#each BUTTONS as button (button.id)}
      {@const Icon = button.icon}
      <button type="button" class="bar-btn" onclick={() => runAction(button.id, 'pointer')}>
        <Icon size={16} strokeWidth={2.25} />
        <span>{t(button.text)}</span>
        <Keys id={button.id} />
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
