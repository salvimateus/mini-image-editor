<script lang="ts">
  import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import { untrack } from 'svelte';
  import { runAction } from '../../app/actions/index.ts';
  import { t } from '../../app/i18n/index.ts';
  import { keyLabels } from '../../app/shortcuts.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app } from '../../app/state.svelte.ts';
  import { toCss, toHex } from '../../core/color.ts';
  import type { Rgba } from '../../core/types.ts';
  import { tooltip } from '../base/tooltip.ts';
  import ColorPicker from './ColorPicker.svelte';

  type Slot = 'fg' | 'bg';

  let editing = $state<Slot>('fg');
  /** Each change of a color from outside this panel (eyedropper, swap, reset) pops its swatch once. */
  let pop = $state({ fg: 0, bg: 0 });
  let own: Slot | null = null;

  const edited = $derived(editing === 'fg' ? app.fg : app.bg);
  const editingName = $derived(t(editing === 'fg' ? 'paint.color.fg' : 'paint.color.bg'));

  function watchPop(slot: Slot, read: () => Rgba): void {
    let first = true;
    $effect(() => {
      void read();
      if (first) {
        first = false;
        return;
      }
      untrack(() => {
        if (own === slot) own = null;
        else pop = { ...pop, [slot]: pop[slot] + 1 };
      });
    });
  }

  watchPop('fg', () => app.fg);
  watchPop('bg', () => app.bg);

  function write(next: Rgba, final: boolean): void {
    own = editing;
    if (editing === 'fg') app.setFg(next, final);
    else app.setBg(next);
    if (final && editing === 'bg') app.remember(next);
  }

  function select(slot: Slot): void {
    if (editing === slot) return;
    editing = slot;
    sfx.play('tick');
  }

  function useRecent(color: Rgba): void {
    sfx.play('pick');
    if (editing === 'fg') app.setFg(color, false);
    else app.setBg(color);
  }
</script>

<section class="side-panel color-panel" aria-labelledby="panel-color-title">
  <h2 id="panel-color-title" class="section-title">{t('chrome.panel.color')}</h2>
  <div class="color-head">
    <div class="swatch-stack">
      <button
        type="button"
        class="swatch swatch-bg"
        aria-pressed={editing === 'bg'}
        aria-label={t('paint.color.bg')}
        use:tooltip={{ text: `${t('paint.color.bg')} ${toHex(app.bg).toUpperCase()}` }}
        onclick={() => select('bg')}
      >
        {#key pop.bg}<span class="swatch-face" class:is-pop={pop.bg > 0} style:--swatch={toCss(app.bg)}></span>{/key}
      </button>
      <button
        type="button"
        class="swatch swatch-fg"
        aria-pressed={editing === 'fg'}
        aria-label={t('paint.color.fg')}
        use:tooltip={{ text: `${t('paint.color.fg')} ${toHex(app.fg).toUpperCase()}` }}
        onclick={() => select('fg')}
      >
        {#key pop.fg}<span class="swatch-face" class:is-pop={pop.fg > 0} style:--swatch={toCss(app.fg)}></span>{/key}
      </button>
    </div>
    <div class="color-tools">
      <button
        type="button"
        class="icon-btn color-tool"
        aria-label={t('paint.color.swap')}
        use:tooltip={{ text: t('paint.color.swap'), keys: keyLabels('color.swap') }}
        onclick={() => runAction('color.swap', 'pointer')}
      >
        <ArrowLeftRight size={16} />
      </button>
      <button
        type="button"
        class="icon-btn color-tool"
        aria-label={t('paint.color.reset')}
        use:tooltip={{ text: t('paint.color.reset'), keys: keyLabels('color.reset') }}
        onclick={() => runAction('color.reset', 'pointer')}
      >
        <RotateCcw size={16} />
      </button>
    </div>
    <p class="color-editing">
      <span>{t('paint.color.editing', { name: editingName })}</span>
      <span class="color-hex">{toHex(edited).toUpperCase()}</span>
    </p>
  </div>

  <ColorPicker color={edited} oninput={(next) => write(next, false)} onchange={(next) => write(next, true)} />

  <div class="recent">
    <h3 class="recent-title">{t('paint.color.recent')}</h3>
    {#if app.recentColors.length === 0}
      <p class="hint">{t('paint.color.recentEmpty')}</p>
    {:else}
      <ul class="recent-grid">
        {#each app.recentColors as color, index (`${toHex(color)}-${index}`)}
          {@const hex = toHex(color).toUpperCase()}
          <li>
            <button
              type="button"
              class="recent-swatch"
              style:--swatch={toCss(color)}
              aria-label={t('paint.color.use', { hex })}
              use:tooltip={{ text: t('paint.color.use', { hex }) }}
              onclick={() => useRecent(color)}
            ></button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  @layer components {
    .color-panel {
      flex: none;
    }

    .color-head {
      display: grid;
      grid-template-columns: auto auto minmax(0, 1fr);
      align-items: center;
      gap: var(--space-3);
    }

    .swatch-stack {
      position: relative;
      width: 58px;
      height: 50px;
    }

    .swatch {
      position: absolute;
      width: 34px;
      height: 34px;
      padding: 0;
      border-radius: var(--radius-s);
      transition: transform var(--dur-hover) var(--ease-spring);

      &:hover {
        transform: translateY(-1px);
      }

      &:active {
        transform: translateY(1px) scale(0.96);
        transition-duration: 60ms;
      }

      &[aria-pressed='true'] {
        z-index: 2;
        outline: 2px solid var(--primary);
        outline-offset: 2px;
      }

      &:focus-visible {
        outline: 3px solid var(--focus);
        outline-offset: 2px;
      }
    }

    .swatch-fg {
      top: 0;
      left: 0;
      z-index: 1;
    }

    .swatch-bg {
      right: 0;
      bottom: 0;
    }

    .swatch-face {
      display: block;
      width: 100%;
      height: 100%;
      background: var(--swatch);
      border: 2px solid var(--hairline-strong);
      border-radius: var(--radius-s);
      box-shadow: 0 2px 0 var(--depth);

      &.is-pop {
        animation: swatch-pop 280ms var(--ease-spring);
      }
    }

    .color-tools {
      display: grid;
      gap: 2px;
    }

    .color-tool {
      width: 30px;
      height: 30px;
      border-radius: var(--radius-s);
    }

    .color-editing {
      display: grid;
      min-width: 0;
      color: var(--text-muted);
      font-size: 0.75rem;
      font-weight: 700;
      line-height: 1.3;
    }

    .color-hex {
      color: var(--text);
      font: 700 0.875rem/1.3 var(--font-mono);
    }

    .recent {
      display: grid;
      gap: var(--space-1);
    }

    .recent-title {
      color: var(--text-muted);
      font-size: 0.75rem;
      font-weight: 800;
    }

    .recent-grid {
      display: grid;
      grid-template-columns: repeat(12, minmax(0, 1fr));
      gap: 3px;
      padding: 0;
      list-style: none;
    }

    .recent-swatch {
      display: block;
      width: 100%;
      aspect-ratio: 1;
      padding: 0;
      background: var(--swatch);
      border: 1px solid var(--hairline-strong);
      border-radius: 4px;
      transition: transform var(--dur-hover) var(--ease-spring);

      &:hover {
        transform: scale(1.18);
      }

      &:active {
        transform: scale(0.94);
        transition-duration: 60ms;
      }
    }

    @keyframes swatch-pop {
      0% {
        transform: scale(1);
      }
      40% {
        transform: scale(1.22);
      }
      100% {
        transform: scale(1);
      }
    }
  }
</style>
