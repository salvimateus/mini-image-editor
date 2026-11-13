<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../app/i18n/index.ts';
  import * as sfx from '../app/sfx.ts';
  import { cleanSideWidth, sideWidth } from '../app/side-width.svelte.ts';
  import { TUNING } from '../app/tuning/index.ts';
  import { tooltip } from './base/tooltip.ts';

  const tuning = TUNING.ui.sideWidth;

  let handle: HTMLDivElement;
  /** The rendered width of the column, also while the default token sets it. */
  let shown = $state<number>(tuning.min);
  let dragging = $state(false);
  let pulse = $state(0);
  let drag: { pointerId: number; startX: number; startWidth: number; moved: boolean } | null = null;

  function column(): HTMLElement | null {
    return handle?.parentElement ?? null;
  }

  /** The layout width: a bounding rect includes the scale of the editor entry animation. */
  function measure(): number {
    return column()?.offsetWidth ?? shown;
  }

  /** The width that the last change set; the DOM shows it only after the next update. */
  function current(): number {
    return sideWidth.width ?? measure();
  }

  function setWidth(next: number): void {
    const width = cleanSideWidth(next);
    if (width !== null && width !== sideWidth.width) sideWidth.set(width);
  }

  function reset(): void {
    sideWidth.set(null);
    sfx.play('snap');
    pulse += 1;
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: current(), moved: false };
    dragging = true;
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    // The handle is on the inner edge: a move to the left makes the column wider.
    const dx = drag.startX - event.clientX;
    // A click with no move keeps the default token.
    if (!drag.moved && Math.abs(dx) < 1) return;
    drag.moved = true;
    setWidth(drag.startWidth + dx);
  }

  function endDrag(): void {
    drag = null;
    dragging = false;
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && drag) {
      event.preventDefault();
      if (drag.moved) setWidth(drag.startWidth);
      handle.releasePointerCapture(drag.pointerId);
      endDrag();
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.shiftKey ? tuning.keyStepBigPx : tuning.keyStepPx;
    setWidth(current() + (event.key === 'ArrowLeft' ? step : -step));
  }

  onMount(() => {
    const target = column();
    if (!target) return;
    shown = measure();
    const observer = new ResizeObserver(() => (shown = measure()));
    observer.observe(target);
    return () => observer.disconnect();
  });
</script>

<!-- A focusable separator with a value is a widget (ARIA window splitter); Svelte lists every separator as static. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  bind:this={handle}
  class="side-resizer"
  class:is-dragging={dragging}
  role="separator"
  tabindex="0"
  aria-orientation="vertical"
  aria-label={t('chrome.panel.width')}
  aria-valuenow={sideWidth.width ?? shown}
  aria-valuemin={tuning.min}
  aria-valuemax={tuning.max}
  style:--pulse-ms="{tuning.resetPulseMs}ms"
  use:tooltip={{ text: t('chrome.panel.widthTip'), keys: ['Drag'] }}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onlostpointercapture={endDrag}
  ondblclick={reset}
  onkeydown={onKeyDown}
>
  {#key pulse}
    <span class="side-resizer-grip" class:is-pulse={pulse > 0} aria-hidden="true"></span>
  {/key}
</div>

<style>
  @layer components {
    .side-resizer {
      position: absolute;
      inset-block: 0;
      /* Centered on the 2px left border of the column. */
      inset-inline-start: -5px;
      z-index: 2;
      display: grid;
      place-items: center;
      width: 12px;
      cursor: col-resize;
      touch-action: none;

      /* The line on the column edge. */
      &::before {
        content: '';
        position: absolute;
        inset-block: 0;
        inset-inline-start: 5px;
        width: 2px;
        background: var(--primary);
        opacity: 0;
        transition: opacity var(--dur-hover) var(--ease-sym);
      }

      &:focus-visible {
        outline: none;
      }

      &:is(:hover, :focus-visible, .is-dragging)::before {
        opacity: 1;
      }

      &:is(:hover, :focus-visible, .is-dragging) .side-resizer-grip {
        opacity: 1;
        transform: scale(1);
      }

      &:focus-visible .side-resizer-grip {
        box-shadow: 0 0 0 3px var(--focus);
      }

      &.is-dragging .side-resizer-grip {
        background: var(--primary-hover);
        transform: scale(1.35, 1.2);
      }
    }

    .side-resizer-grip {
      position: relative;
      width: 6px;
      height: 36px;
      background: var(--primary);
      border: 1px solid var(--primary-edge);
      border-radius: var(--radius-pill);
      opacity: 0;
      transform: scale(0.6, 0.4);
      transition:
        opacity var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &.is-pulse {
        animation: side-resizer-pulse var(--pulse-ms) var(--ease-out);
      }
    }

    @keyframes side-resizer-pulse {
      0% {
        opacity: 1;
        transform: scale(1.8, 1.4);
      }
      100% {
        opacity: 1;
        transform: scale(1);
      }
    }
  }
</style>
