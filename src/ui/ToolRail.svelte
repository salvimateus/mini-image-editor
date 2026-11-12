<script lang="ts" module>
  import type { Component } from 'svelte';
  import Brush from '@lucide/svelte/icons/brush';
  import CircleDashed from '@lucide/svelte/icons/circle-dashed';
  import Crop from '@lucide/svelte/icons/crop';
  import Eraser from '@lucide/svelte/icons/eraser';
  import Hand from '@lucide/svelte/icons/hand';
  import ListOrdered from '@lucide/svelte/icons/list-ordered';
  import Lasso from '@lucide/svelte/icons/lasso';
  import Move from '@lucide/svelte/icons/move';
  import PaintBucket from '@lucide/svelte/icons/paint-bucket';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Pipette from '@lucide/svelte/icons/pipette';
  import SquareDashed from '@lucide/svelte/icons/square-dashed';
  import Stamp from '@lucide/svelte/icons/stamp';
  import Shapes from '@lucide/svelte/icons/shapes';
  import Type from '@lucide/svelte/icons/type';
  import WandSparkles from '@lucide/svelte/icons/wand-sparkles';
  import ZoomIn from '@lucide/svelte/icons/zoom-in';
  import type { TextKey } from '../app/i18n/index.ts';
  import type { ActionId } from '../app/shortcuts.ts';
  import type { ToolId } from '../app/tools/types.ts';

  export interface ToolMeta { icon: Component<{ size?: number | string; strokeWidth?: number | string }>; label: TextKey; action: ActionId }

  /** The one table of tool metadata: icon, name and action. */
  export const TOOL_META: Record<ToolId, ToolMeta> = {
    move: { icon: Move, label: 'chrome.tool.move', action: 'tool.move' },
    'marquee-rect': { icon: SquareDashed, label: 'chrome.tool.marquee-rect', action: 'tool.marquee-rect' },
    'marquee-ellipse': { icon: CircleDashed, label: 'chrome.tool.marquee-ellipse', action: 'tool.marquee-ellipse' },
    lasso: { icon: Lasso, label: 'chrome.tool.lasso', action: 'tool.lasso' },
    wand: { icon: WandSparkles, label: 'chrome.tool.wand', action: 'tool.wand' },
    crop: { icon: Crop, label: 'chrome.tool.crop', action: 'tool.crop' },
    eyedropper: { icon: Pipette, label: 'chrome.tool.eyedropper', action: 'tool.eyedropper' },
    brush: { icon: Brush, label: 'chrome.tool.brush', action: 'tool.brush' },
    pencil: { icon: Pencil, label: 'chrome.tool.pencil', action: 'tool.pencil' },
    eraser: { icon: Eraser, label: 'chrome.tool.eraser', action: 'tool.eraser' },
    bucket: { icon: PaintBucket, label: 'chrome.tool.bucket', action: 'tool.bucket' },
    clone: { icon: Stamp, label: 'chrome.tool.clone', action: 'tool.clone' },
    text: { icon: Type, label: 'chrome.tool.text', action: 'tool.text' },
    shape: { icon: Shapes, label: 'chrome.tool.shape', action: 'tool.shape' },
    step: { icon: ListOrdered, label: 'chrome.tool.step', action: 'tool.step' },
    hand: { icon: Hand, label: 'chrome.tool.hand', action: 'tool.hand' },
    zoom: { icon: ZoomIn, label: 'chrome.tool.zoom', action: 'tool.zoom' },
  };

  export const TOOL_GROUPS: readonly (readonly ToolId[])[] = [
    ['move'],
    ['marquee-rect', 'marquee-ellipse', 'lasso', 'wand'],
    ['crop'],
    ['brush', 'pencil', 'eraser', 'bucket', 'clone'],
    ['shape', 'step'],
    ['eyedropper'],
    ['text'],
    ['hand', 'zoom'],
  ];
</script>

<script lang="ts">
  import { runAction } from '../app/actions/index.ts';
  import { app } from '../app/state.svelte.ts';
  import { t } from '../app/i18n/index.ts';
  import { keyLabels } from '../app/shortcuts.ts';
  import { tooltip } from './base/tooltip.ts';
</script>

<nav class="rail" aria-label={t('chrome.toolRail')}>
  <div class="rail-inner">
  {#each TOOL_GROUPS as group, index (index)}
    <div class="rail-group">
      {#each group as id (id)}
        {@const meta = TOOL_META[id]}
        {@const Icon = meta.icon}
        <button
          type="button"
          class="tool"
          class:is-active={app.tool === id}
          aria-pressed={app.tool === id}
          aria-label={t(meta.label)}
          use:tooltip={{ text: t(meta.label), keys: keyLabels(meta.action) }}
          onclick={() => runAction(meta.action, 'pointer')}
        >
          <Icon size={20} strokeWidth={2.25} />
        </button>
      {/each}
    </div>
  {/each}
  </div>
</nav>

<style>
  @layer components {
    /* The rail height drives the button size, so every tool stays visible in a short window. */
    .rail {
      --tool-size: 40px;
      --tool-gap: 3px;
      --group-gap: var(--space-2);
      --icon-size: 20px;
      container-type: size;
      min-height: 0;
      overflow-y: auto;
      scrollbar-width: none;
      background: var(--surface-1);
      border-right: 2px solid var(--line);
    }

    .rail-inner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--group-gap);
      padding: var(--group-gap) 0;
    }

    /* Each step holds the 17 tools in 8 groups: about 850, 690, 572 and 513 px tall. A 960 x 640 window gives the rail about 556 px. */
    @container (max-height: 860px) {
      .rail-inner {
        --tool-size: 34px;
        --tool-gap: 2px;
        --group-gap: 5px;
        --icon-size: 18px;
      }
    }

    @container (max-height: 700px) {
      .rail-inner {
        --tool-size: 28px;
        --tool-gap: 2px;
        --group-gap: 4px;
        --icon-size: 16px;
      }
    }

    @container (max-height: 580px) {
      .rail-inner {
        --tool-size: 26px;
        --tool-gap: 1px;
        --group-gap: 3px;
        --icon-size: 15px;
      }
    }

    .rail-group {
      display: grid;
      gap: var(--tool-gap);

      & + & {
        padding-top: var(--group-gap);
        border-top: 2px solid var(--line);
      }
    }

    .tool {
      position: relative;
      display: grid;
      place-items: center;
      width: var(--tool-size);
      height: var(--tool-size);
      color: var(--text-muted);
      border-radius: var(--radius-m);
      transition:
        transform var(--dur-hover) var(--ease-spring),
        background-color var(--dur-hover) var(--ease-sym),
        color var(--dur-hover) var(--ease-sym);

      &:hover:not(.is-active) {
        color: var(--text);
        background: var(--surface-3);
        transform: translateY(-1px);
      }

      &:active {
        transform: translateY(2px) scale(0.92);
        transition-duration: 60ms;
      }

      & :global(svg) {
        width: var(--icon-size);
        height: var(--icon-size);
      }

      &.is-active {
        color: var(--on-primary);
        background: var(--primary);
        box-shadow: 0 3px 0 var(--primary-depth);
        animation: tool-pick var(--dur-pop) var(--ease-spring);
      }
    }

    @keyframes tool-pick {
      0% {
        scale: 0.8;
      }
      60% {
        scale: 1.1;
      }
      100% {
        scale: 1;
      }
    }
  }
</style>
