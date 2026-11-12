<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import { actionChecked, actionEnabled, runAction } from '../app/actions/index.ts';
  import { t } from '../app/i18n/index.ts';
  import { shortcutOf, type ActionId } from '../app/shortcuts.ts';
  import * as sfx from '../app/sfx.ts';
  import Keys from './base/Keys.svelte';

  interface Props {
    id: string;
    label: string;
    /** null draws a separator. */
    items: readonly (ActionId | null)[];
    open: boolean;
    /** The menu bar decides which menu is open: one at a time, and a hover moves between them while one is open. */
    ontoggle: () => void;
    onhover: () => void;
    onclose: () => void;
  }

  let { id, label, items, open, ontoggle, onhover, onclose }: Props = $props();
  let trigger: HTMLButtonElement;
  let list = $state<HTMLDivElement>();

  function rows(): HTMLButtonElement[] {
    return list ? Array.from(list.querySelectorAll<HTMLButtonElement>('.menu-row:not(:disabled)')) : [];
  }

  function focusRow(step: number): void {
    const all = rows();
    if (all.length === 0) return;
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = index < 0 ? (step > 0 ? 0 : all.length - 1) : (index + step + all.length) % all.length;
    all[next].focus();
  }

  function run(action: ActionId): void {
    onclose();
    trigger.focus();
    runAction(action, 'pointer');
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') focusRow(1);
    else if (event.key === 'ArrowUp') focusRow(-1);
    else if (event.key === 'Escape') {
      onclose();
      trigger.focus();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onTriggerKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    if (!open) ontoggle();
    requestAnimationFrame(() => focusRow(1));
  }
</script>

<div class="menu">
  <button
    bind:this={trigger}
    type="button"
    class="menu-trigger"
    class:is-open={open}
    id="menu-{id}"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls="menu-{id}-list"
    onclick={() => {
      sfx.play('tick');
      ontoggle();
    }}
    onpointerenter={onhover}
    onkeydown={onTriggerKey}
  >
    {label}
  </button>
  {#if open}
    <div bind:this={list} class="menu-list" id="menu-{id}-list" role="menu" aria-labelledby="menu-{id}" tabindex="-1" onkeydown={onKey}>
      {#each items as item, index (item ?? `sep-${index}`)}
        {#if item === null}
          <div class="menu-sep" role="separator"></div>
        {:else}
          {@const checked = actionChecked(item)}
          <button
            type="button"
            class="menu-row"
            role={checked === null ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={checked === null ? undefined : checked}
            disabled={!actionEnabled(item)}
            onclick={() => run(item)}
          >
            <span class="menu-check" aria-hidden="true">
              {#if checked}<Check size={15} strokeWidth={3} />{/if}
            </span>
            <span class="menu-label">{t(shortcutOf(item).label)}</span>
            <Keys id={item} />
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  @layer components {
    .menu {
      position: relative;
    }

    .menu-trigger {
      height: 34px;
      padding: 0 var(--space-3);
      color: var(--text-muted);
      border-radius: var(--radius-s);
      font: 800 0.875rem/1 var(--font-display);
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        color var(--dur-hover) var(--ease-sym);

      &:hover,
      &.is-open {
        color: var(--text);
        background: var(--surface-3);
      }
    }

    /* A narrow window keeps the eight menus, the document name and the actions on one row. */
    @media (max-width: 1180px) {
      .menu-trigger {
        padding: 0 var(--space-2);
      }
    }

    .menu-list {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      z-index: 50;
      display: grid;
      width: max-content;
      min-width: 260px;
      max-width: calc(100vw - 16px);
      padding: var(--space-1);
      background: var(--surface-2);
      border: 2px solid var(--line-strong);
      border-radius: var(--radius-m);
      box-shadow: 0 6px 0 var(--depth);
      transform-origin: top left;
      animation: menu-in var(--dur-pop) var(--ease-out);
    }

    .menu-row {
      display: grid;
      grid-template-columns: 18px 1fr auto;
      align-items: center;
      gap: var(--space-2);
      column-gap: var(--space-3);
      min-height: 32px;
      padding: 0 var(--space-2);
      color: var(--text);
      border-radius: var(--radius-s);
      font-size: 0.875rem;
      font-weight: 700;
      text-align: left;
      transition:
        background-color var(--dur-instant) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover:not(:disabled),
      &:focus-visible {
        background: var(--primary-fill);
        outline-offset: -2px;
      }

      &:active:not(:disabled) {
        transform: scale(0.98);
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.4;
      }
    }

    .menu-check {
      display: grid;
      place-items: center;
      color: var(--primary);
    }

    .menu-label {
      white-space: nowrap;
    }

    .menu-sep {
      height: 2px;
      margin: var(--space-1) var(--space-2);
      background: var(--line);
    }

    @keyframes menu-in {
      from {
        opacity: 0;
        transform: translateY(-4px) scale(0.97);
      }
    }
  }
</style>
