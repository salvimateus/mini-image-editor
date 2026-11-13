<script lang="ts">
  import { app } from '../app/state.svelte.ts';
  import { t } from '../app/i18n/index.ts';
  import { TOOLS, type Hint } from '../app/tools/index.ts';
  import Keys from './base/Keys.svelte';

  const PERMANENT: readonly Hint[] = [
    { keys: 'Space+Drag', text: 'chrome.hint.pan' },
    { keys: 'Wheel', text: 'chrome.hint.zoom' },
  ];

  /** 'Alt+Click' → [['Alt'], ['Click']]; '[ ]' → [['[', ']']]. */
  function parts(keys: string): string[][] {
    return keys.split('+').map((token) => token.trim().split(/\s+/).filter(Boolean));
  }

  // The tool hints come first; the permanent hints close the list.
  const toolHints = $derived(TOOLS[app.tool]?.hints ?? []);
  const hints = $derived([...toolHints, ...PERMANENT.filter((hint) => !toolHints.some((own) => own.keys === hint.keys))]);
  const ownCount = $derived(toolHints.length);

  let scroller = $state<HTMLUListElement>();
  let fadeStart = $state(false);
  let fadeEnd = $state(false);
  let drag: { id: number; x: number; left: number; moved: boolean } | null = null;

  /** Fades only the edge that hides more hints. */
  function updateFades(): void {
    if (!scroller) return;
    const max = scroller.scrollWidth - scroller.clientWidth;
    fadeStart = scroller.scrollLeft > 1;
    fadeEnd = scroller.scrollLeft < max - 1;
  }

  $effect(() => {
    void app.tool;
    if (!scroller) return;
    scroller.scrollLeft = 0;
    // The new hints lay out in the next frame.
    const frame = requestAnimationFrame(updateFades);
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    if (!scroller) return;
    const node = scroller;
    const observer = new ResizeObserver(updateFades);
    observer.observe(node);
    // Not passive: the wheel scrolls the bar instead of the page.
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      node.removeEventListener('wheel', onWheel);
    };
  });

  /** A vertical wheel scrolls the bar sideways, so a mouse with one wheel reaches every hint. */
  function onWheel(event: WheelEvent): void {
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    event.preventDefault();
    scroller.scrollLeft += delta;
  }

  function onPointerDown(event: PointerEvent): void {
    if (!scroller || event.button !== 0 || scroller.scrollWidth <= scroller.clientWidth) return;
    drag = { id: event.pointerId, x: event.clientX, left: scroller.scrollLeft, moved: false };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!scroller || !drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      scroller.setPointerCapture(event.pointerId);
    }
    scroller.scrollLeft = drag.left - dx;
  }

  function onPointerUp(event: PointerEvent): void {
    if (drag?.id !== event.pointerId) return;
    if (scroller?.hasPointerCapture(event.pointerId)) scroller.releasePointerCapture(event.pointerId);
    drag = null;
  }
</script>

<div class="hintbar" aria-label={t('chrome.hints')}>
  <ul
    bind:this={scroller}
    class="hints"
    class:fade-start={fadeStart}
    class:fade-end={fadeEnd}
    onscroll={updateFades}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  >
    {#key app.tool}
      {#each hints as hint, index (index)}
        <li class="hint-item" class:is-permanent={index >= ownCount} style:--i={index}>
          <!-- A hint with no keys is plain text. -->
          {#if hint.keys}
            <span class="combo">
              {#each parts(hint.keys) as part, partIndex (partIndex)}
                {#if partIndex > 0}<span class="plus" aria-hidden="true">+</span>{/if}
                <Keys keys={part} hint />
              {/each}
            </span>
          {/if}
          <span class="hint-text">{t(hint.text)}</span>
        </li>
      {/each}
    {/key}
  </ul>
</div>

<style>
  @layer components {
    .hintbar {
      min-width: 0;
      height: 34px;
      overflow: hidden;
      background: var(--surface-sunken);
      border-top: 2px solid var(--line);
    }

    .hints {
      --fade-start: 0px;
      --fade-end: 0px;
      display: flex;
      align-items: center;
      gap: var(--space-4);
      height: 100%;
      padding-inline: var(--space-3);
      overflow-x: auto;
      overflow-y: hidden;
      overscroll-behavior-x: contain;
      scrollbar-width: none;
      list-style: none;
      white-space: nowrap;
      mask-image: linear-gradient(to right, transparent, #000 var(--fade-start), #000 calc(100% - var(--fade-end)), transparent);

      &::-webkit-scrollbar {
        display: none;
      }

      &.fade-start {
        --fade-start: 32px;
      }

      &.fade-end {
        --fade-end: 32px;
      }
    }

    .hint-item {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: var(--space-2);
      font-size: 0.8125rem;
      font-weight: 700;
      color: var(--text-muted);
      animation: hint-in var(--dur-pop) var(--ease-out) calc(var(--i) * 40ms) both;

      &.is-permanent {
        color: var(--text-faint);
      }
    }

    .combo {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: 0.3em;
    }

    .plus {
      color: var(--text-faint);
      font-weight: 800;
    }

    @keyframes hint-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
    }
  }
</style>
