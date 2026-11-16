<script lang="ts">
  import { t, type TextKey } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import { sameColor, toCss } from '../../core/color.ts';
  import type { Rgba } from '../../core/types.ts';
  import { tooltip } from '../base/tooltip.ts';
  import PaintOptions from './PaintOptions.svelte';

  const NAMES: Record<(typeof TUNING.paint.highlightColors)[number]['id'], TextKey> = {
    yellow: 'paint.highlight.yellow',
    green: 'paint.highlight.green',
    pink: 'paint.highlight.pink',
    cyan: 'paint.highlight.cyan',
    orange: 'paint.highlight.orange',
  };

  function pick(color: Rgba): void {
    sfx.play('pick');
    // The stroke start puts the color in the recent colors.
    app.setFg(color, false);
  }
</script>

<div class="highlighter-options">
  <div class="swatches" role="group" aria-label={t('paint.highlight.colors')}>
    {#each TUNING.paint.highlightColors as entry (entry.id)}
      <button
        type="button"
        class="swatch"
        style:--swatch={toCss(entry.color)}
        aria-label={t(NAMES[entry.id])}
        aria-pressed={sameColor(app.fg, entry.color)}
        use:tooltip={{ text: t(NAMES[entry.id]) }}
        onclick={() => pick(entry.color)}
      ></button>
    {/each}
  </div>
  <PaintOptions tool="highlighter" />
</div>

<style>
  @layer components {
    .highlighter-options {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;
    }

    .swatches {
      display: flex;
      flex: none;
      gap: var(--space-1);
      padding: 3px;
      background: var(--surface-sunken);
      border: 2px solid var(--line);
      border-radius: var(--radius-m);
    }

    .swatch {
      width: 24px;
      height: 24px;
      padding: 0;
      background: var(--swatch);
      border: 1px solid var(--hairline-strong);
      border-radius: var(--radius-s);
      transition: transform var(--dur-hover) var(--ease-spring);

      &:hover {
        transform: scale(1.12);
      }

      &:active {
        transform: scale(0.94);
        transition-duration: 60ms;
      }

      &[aria-pressed='true'] {
        outline: 2px solid var(--text);
        outline-offset: 1px;
      }
    }
  }
</style>
