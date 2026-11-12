<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Palette from '@lucide/svelte/icons/palette';
  import { tick } from 'svelte';
  import { t } from '../app/i18n/index.ts';
  import * as sfx from '../app/sfx.ts';
  import { setTheme, theme, THEMES, type ThemeId } from '../app/theme.svelte.ts';
  import { tooltip } from './base/tooltip.ts';

  interface Props {
    /** In the top bar the button follows the size of the other bar buttons, which shrink on narrow windows. */
    inBar?: boolean;
  }

  let { inBar = false }: Props = $props();

  let open = $state(false);
  let box: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let list = $state<HTMLDivElement | null>(null);

  function items(): HTMLButtonElement[] {
    return list ? Array.from(list.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')) : [];
  }

  async function show(): Promise<void> {
    open = true;
    await tick();
    const current = items().find((item) => item.dataset.themeId === theme.current);
    current?.focus();
  }

  function hide(returnFocus: boolean): void {
    if (!open) return;
    open = false;
    if (returnFocus) trigger.focus();
  }

  function toggle(): void {
    sfx.play('tick');
    if (open) hide(false);
    else void show();
  }

  function pick(id: ThemeId): void {
    sfx.play('tick');
    setTheme(id);
  }

  function onListKey(event: KeyboardEvent): void {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = (index + 1) % all.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = (index - 1 + all.length) % all.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = all.length - 1;
        break;
      case 'Escape':
        event.stopPropagation();
        hide(true);
        return;
      case 'Tab':
        hide(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    all[next]?.focus();
  }

  function onWindowPointer(event: PointerEvent): void {
    if (open && !box.contains(event.target as Node)) hide(false);
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onblur={() => hide(false)} />

<div class="theme-picker" bind:this={box}>
  <button
    type="button"
    class="icon-btn"
    class:in-bar={inBar}
    aria-label={t('theme.button')}
    aria-haspopup="menu"
    aria-expanded={open}
    use:tooltip={{ text: t('theme.button') }}
    bind:this={trigger}
    onclick={toggle}
    onkeydown={(event) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation();
        hide(true);
      }
    }}
  >
    <Palette size={20} />
  </button>

  {#if open}
    <div class="theme-panel" role="menu" aria-label={t('theme.panel')} tabindex="-1" bind:this={list} onkeydown={onListKey}>
      <p class="theme-title" aria-hidden="true">{t('theme.panel')}</p>
      {#each THEMES as entry (entry.id)}
        {@const current = theme.current === entry.id}
        <button
          type="button"
          class="theme-card"
          class:is-current={current}
          role="menuitemradio"
          aria-checked={current}
          data-theme-id={entry.id}
          onclick={() => pick(entry.id)}
        >
          <span class="swatches" aria-hidden="true">
            {#each entry.swatches as color, i (i)}
              <span class="swatch" style:background={color}></span>
            {/each}
          </span>
          <span class="theme-name">{t(entry.label)}</span>
          <span class="theme-kind">{t(entry.kind === 'light' ? 'theme.light' : 'theme.dark')}</span>
          <span class="theme-mark" aria-hidden="true">
            {#if current}<Check size={16} strokeWidth={3} />{/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  @layer components {
    .theme-picker {
      position: relative;
    }

    .theme-panel {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 60;
      display: grid;
      gap: 4px;
      width: 260px;
      padding: var(--space-2);
      background: var(--surface-2);
      border: 2px solid var(--line-strong);
      border-radius: var(--radius-l);
      box-shadow: 0 6px 0 var(--depth);
      transform-origin: top right;
      animation: theme-panel-in var(--dur-pop) var(--ease-spring);
    }

    .theme-title {
      padding: 2px var(--space-2) var(--space-1);
      color: var(--text-muted);
      font: 800 0.8125rem/1.2 var(--font-display);
    }

    .theme-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto 18px;
      align-items: center;
      gap: var(--space-2);
      min-height: 44px;
      padding: 0 var(--space-2);
      color: var(--text);
      border: 2px solid transparent;
      border-radius: var(--radius-m);
      text-align: left;
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        border-color var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover {
        background: var(--surface-hover);
      }

      &:active {
        transform: scale(0.97);
      }

      &.is-current {
        background: var(--primary-fill);
        border-color: var(--primary);
      }
    }

    .swatches {
      display: flex;
    }

    .swatch {
      width: 18px;
      height: 18px;
      border: 2px solid var(--surface-2);
      border-radius: var(--radius-pill);
      box-shadow: 0 0 0 1px var(--line-strong);

      & + & {
        margin-left: -6px;
      }
    }

    .theme-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font: 800 0.9375rem/1.2 var(--font-display);
    }

    .theme-kind {
      padding: 2px 8px;
      color: var(--text-muted);
      background: var(--surface-sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius-pill);
      font-size: 0.75rem;
      font-weight: 700;
    }

    .theme-mark {
      display: grid;
      place-items: center;
      color: var(--primary);
    }

    /* The same breakpoint and size as the action buttons of TopBar.svelte. */
    @media (max-width: 1180px) {
      .in-bar {
        width: 34px;
        height: 34px;
      }
    }

    @keyframes theme-panel-in {
      from {
        opacity: 0;
        transform: translateY(-4px) scale(0.96);
      }
    }
  }
</style>
