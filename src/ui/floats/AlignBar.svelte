<script lang="ts">
  import AlignHorizontalJustifyCenter from '@lucide/svelte/icons/align-horizontal-justify-center';
  import AlignHorizontalJustifyEnd from '@lucide/svelte/icons/align-horizontal-justify-end';
  import AlignHorizontalJustifyStart from '@lucide/svelte/icons/align-horizontal-justify-start';
  import AlignVerticalJustifyCenter from '@lucide/svelte/icons/align-vertical-justify-center';
  import AlignVerticalJustifyEnd from '@lucide/svelte/icons/align-vertical-justify-end';
  import AlignVerticalJustifyStart from '@lucide/svelte/icons/align-vertical-justify-start';
  import { runAction } from '../../app/actions/index.ts';
  import { t } from '../../app/i18n/index.ts';
  import { shortcutOf, type ActionId } from '../../app/shortcuts.ts';
  import { app } from '../../app/state.svelte.ts';
  import { stageDragging } from '../../app/tools/marquee-rect.ts';
  import { layerBounds, transformOn } from '../../app/tools/move.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import { tooltip } from '../base/tooltip.ts';

  const BUTTONS: readonly { id: ActionId; icon: typeof AlignHorizontalJustifyStart }[] = [
    { id: 'layer.alignLeft', icon: AlignHorizontalJustifyStart },
    { id: 'layer.alignCenterH', icon: AlignHorizontalJustifyCenter },
    { id: 'layer.alignRight', icon: AlignHorizontalJustifyEnd },
    { id: 'layer.alignTop', icon: AlignVerticalJustifyStart },
    { id: 'layer.alignCenterV', icon: AlignVerticalJustifyCenter },
    { id: 'layer.alignBottom', icon: AlignVerticalJustifyEnd },
  ];

  let barW = $state(0);
  let barH = $state(0);

  const shown = $derived(app.tool === 'move' && !$stageDragging && !$transformOn);

  /** Above the visible bounds of the active layer, centered; below them when there is no room above. */
  const pos = $derived.by(() => {
    if (!shown) return null;
    void app.viewTick;
    const stage = app.stage;
    const doc = app.doc;
    const layer = doc?.active;
    if (!stage || !doc || !layer || !layer.visible) return null;
    const b = layerBounds(doc, layer);
    if (!b) return null;
    const { gapPx, edgePx } = TUNING.select.bar;
    const top = stage.docToScreen(b.x + b.w / 2, b.y);
    const bottom = stage.docToScreen(b.x + b.w / 2, b.y + b.h);
    const { width, height } = stage.viewport;
    let y = top.y - gapPx - barH;
    if (y < edgePx) y = bottom.y + gapPx;
    const x = Math.max(edgePx, Math.min(width - edgePx - barW, top.x - barW / 2));
    y = Math.max(edgePx, Math.min(height - edgePx - barH, y));
    return { x: Math.round(x), y: Math.round(y) };
  });
</script>

{#if pos}
  <div class="align-bar" role="toolbar" aria-label={t('select.align.bar')} style:translate="{pos.x}px {pos.y}px" bind:offsetWidth={barW} bind:offsetHeight={barH}>
    {#each BUTTONS as button, index (button.id)}
      {@const Icon = button.icon}
      {#if index === 3}<span class="align-sep" aria-hidden="true"></span>{/if}
      <button
        type="button"
        class="icon-btn align-btn"
        aria-label={t(shortcutOf(button.id).label)}
        use:tooltip={{ text: t(shortcutOf(button.id).label) }}
        onclick={() => runAction(button.id, 'pointer')}
      >
        <Icon size={18} strokeWidth={2.25} />
      </button>
    {/each}
  </div>
{/if}

<style>
  @layer components {
    .align-bar {
      position: absolute;
      top: 0;
      left: 0;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: var(--space-1);
      background: var(--surface-1);
      border: 2px solid var(--line-strong);
      border-radius: var(--radius-m);
      box-shadow: 0 4px 0 var(--depth);
      animation: align-in var(--dur-pop) var(--ease-spring);
    }

    .align-btn {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-s);
    }

    .align-sep {
      width: 2px;
      height: 20px;
      margin: 0 var(--space-1);
      background: var(--line);
      border-radius: 1px;
    }

    @keyframes align-in {
      from {
        opacity: 0;
        scale: 0.92;
      }
    }
  }
</style>
