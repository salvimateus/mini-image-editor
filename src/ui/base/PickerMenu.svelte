<script lang="ts" generics="Id extends string, Entry extends { id: Id }">
  import Check from '@lucide/svelte/icons/check';
  import { tick, type Snippet } from 'svelte';
  import * as sfx from '../../app/sfx.ts';
  import { tooltip } from './tooltip.ts';

  interface Props {
    /** The name of the trigger: its aria-label and its tooltip. */
    label: string;
    /** The title of the open menu and its aria-label. */
    title: string;
    entries: readonly Entry[];
    current: Id;
    onpick: (id: Id) => void;
    /** In the top bar the button follows the size of the other bar buttons, which shrink on narrow windows. */
    inBar?: boolean;
    icon: Snippet;
    /** The content of one menu row, before the check mark. Use the classes picker-name and picker-tag for the text. */
    row: Snippet<[Entry]>;
    /** The class of the trigger button. */
    triggerClass?: string;
    /** Shows `label` as the tooltip of the trigger. */
    triggerTooltip?: boolean;
    /** Runs before the trigger opens or closes the menu; true = the press is used, the menu stays as it is. */
    ontrigger?: () => boolean;
    /** The side of the trigger that the menu lines up with. */
    side?: 'start' | 'end';
    /** A box in client px that the open menu stays inside: it opens up when there is no room below. */
    bounds?: () => DOMRect | null;
    /** The menu closes after a pick and gives the focus back to the trigger. */
    closeOnPick?: boolean;
    isDisabled?: (entry: Entry) => boolean;
    onopenchange?: (open: boolean) => void;
    /** The row under the pointer or with the focus, or null. */
    onpreview?: (id: Id | null) => void;
  }

  let {
    label,
    title,
    entries,
    current,
    onpick,
    inBar = false,
    icon,
    row,
    triggerClass = 'icon-btn',
    triggerTooltip = true,
    ontrigger,
    side = 'end',
    bounds,
    closeOnPick = false,
    isDisabled,
    onopenchange,
    onpreview,
  }: Props = $props();

  /** The margin from the edges of `bounds`, in CSS px. */
  const BOUNDS_MARGIN = 8;

  let open = $state(false);
  let up = $state(false);
  let shift = $state(0);
  let box: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let list = $state<HTMLDivElement | null>(null);

  function items(): HTMLButtonElement[] {
    return list ? Array.from(list.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)')) : [];
  }

  function setOpen(value: boolean): void {
    open = value;
    onopenchange?.(value);
    if (!value) onpreview?.(null);
  }

  function place(): void {
    const area = bounds?.();
    if (!area || !list) return;
    // Layout offsets, not the client rect of the panel: the open animation scales it.
    const origin = box.getBoundingClientRect();
    const width = list.offsetWidth;
    const left = origin.left + list.offsetLeft;
    const bottom = origin.top + list.offsetTop + list.offsetHeight;
    up = bottom > area.bottom - BOUNDS_MARGIN && origin.top - area.top > area.bottom - origin.bottom;
    let dx = 0;
    if (left + width > area.right - BOUNDS_MARGIN) dx = area.right - BOUNDS_MARGIN - (left + width);
    if (left + dx < area.left + BOUNDS_MARGIN) dx = area.left + BOUNDS_MARGIN - left;
    shift = Math.round(dx);
  }

  async function show(): Promise<void> {
    up = false;
    shift = 0;
    setOpen(true);
    await tick();
    place();
    items()
      .find((item) => item.dataset.entryId === current)
      ?.focus();
  }

  function hide(returnFocus: boolean): void {
    if (!open) return;
    setOpen(false);
    if (returnFocus) trigger.focus();
  }

  function toggle(): void {
    sfx.play('tick');
    if (ontrigger?.()) return;
    if (open) hide(false);
    else void show();
  }

  function pick(id: Id): void {
    sfx.play('tick');
    if (closeOnPick) hide(true);
    onpick(id);
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

<div class="picker" bind:this={box}>
  <button
    type="button"
    class={triggerClass}
    class:in-bar={inBar}
    aria-label={label}
    aria-haspopup="menu"
    aria-expanded={open}
    use:tooltip={{ text: triggerTooltip ? label : '' }}
    bind:this={trigger}
    onclick={toggle}
    onkeydown={(event) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation();
        hide(true);
      }
    }}
  >
    {@render icon()}
  </button>

  {#if open}
    <div
      class="picker-panel"
      class:is-start={side === 'start'}
      class:is-up={up}
      style:translate={shift ? `${shift}px 0` : null}
      role="menu"
      aria-label={title}
      tabindex="-1"
      bind:this={list}
      onkeydown={onListKey}
      onpointerleave={() => onpreview?.(null)}
    >
      <p class="picker-title" aria-hidden="true">{title}</p>
      {#each entries as entry (entry.id)}
        {@const checked = current === entry.id}
        {@const disabled = isDisabled?.(entry) ?? false}
        <button
          type="button"
          class="picker-row"
          class:is-current={checked}
          role="menuitemradio"
          aria-checked={checked}
          {disabled}
          data-entry-id={entry.id}
          onclick={() => pick(entry.id)}
          onpointerenter={() => onpreview?.(disabled ? null : entry.id)}
          onfocus={() => onpreview?.(entry.id)}
        >
          {@render row(entry)}
          <span class="picker-mark" aria-hidden="true">
            {#if checked}<Check size={16} strokeWidth={3} />{/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  @layer components {
    .picker {
      position: relative;
    }

    .picker-panel {
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
      animation: picker-panel-in var(--dur-pop) var(--ease-spring);

      &.is-start {
        right: auto;
        left: 0;
        transform-origin: top left;
      }

      &.is-up {
        top: auto;
        bottom: calc(100% + 8px);
        transform-origin: bottom right;
      }

      &.is-start.is-up {
        transform-origin: bottom left;
      }
    }

    .picker-title {
      padding: 2px var(--space-2) var(--space-1);
      color: var(--text-muted);
      font: 800 0.8125rem/1.2 var(--font-display);
    }

    .picker-row {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      /* A long name shrinks with its ellipsis instead of making the row wider than the panel. */
      min-width: 0;
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

      &:hover:not(:disabled) {
        background: var(--surface-hover);
      }

      &:active:not(:disabled) {
        transform: scale(0.97);
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }

      &.is-current {
        background: var(--primary-fill);
        border-color: var(--primary);
      }
    }

    /* The row content comes from the snippet of the picker, so these two classes reach it through :global. */
    .picker-row :global(.picker-name) {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font: 800 0.9375rem/1.2 var(--font-display);
    }

    .picker-row :global(.picker-tag) {
      flex: none;
      padding: 2px 8px;
      color: var(--text-muted);
      background: var(--surface-sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius-pill);
      font-size: 0.75rem;
      font-weight: 700;
    }

    .picker-mark {
      display: grid;
      flex: none;
      place-items: center;
      width: 18px;
      color: var(--primary);
    }

    /* The same breakpoint and size as the action buttons of TopBar.svelte. */
    @media (max-width: 1180px) {
      .in-bar {
        width: 34px;
        height: 34px;
      }
    }

    @keyframes picker-panel-in {
      from {
        opacity: 0;
        transform: translateY(-4px) scale(0.96);
      }
    }
  }
</style>
