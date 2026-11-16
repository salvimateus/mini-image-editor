<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { runAction } from '../app/actions/index.ts';
  import type { EditorDoc } from '../app/doc.svelte.ts';
  import { t } from '../app/i18n/index.ts';
  import { app } from '../app/state.svelte.ts';
  import { tooltip } from './base/tooltip.ts';

  let strip: HTMLDivElement;
  /** The tab that holds the keyboard focus stop: the arrows move it, Enter selects it. */
  let focusDoc = $state.raw<EditorDoc | null>(null);
  const tabs = new Map<EditorDoc, HTMLButtonElement>();

  const stopDoc = $derived(focusDoc && app.docs.includes(focusDoc) ? focusDoc : app.doc);

  function register(node: HTMLButtonElement, doc: EditorDoc) {
    tabs.set(doc, node);
    return {
      destroy() {
        if (tabs.get(doc) === node) tabs.delete(doc);
      },
    };
  }

  function focusTab(doc: EditorDoc): void {
    focusDoc = doc;
    const node = tabs.get(doc);
    node?.focus();
    if (node) reveal(node);
  }

  /** Scrolls the strip only, so the page itself never moves. */
  function reveal(node: HTMLElement): void {
    const left = node.offsetLeft;
    const right = left + node.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  }

  function onTabKey(event: KeyboardEvent, doc: EditorDoc): void {
    const docs = app.docs;
    const index = docs.indexOf(doc);
    let next: EditorDoc | undefined;
    if (event.key === 'ArrowRight') next = docs[(index + 1) % docs.length];
    else if (event.key === 'ArrowLeft') next = docs[(index - 1 + docs.length) % docs.length];
    else if (event.key === 'Home') next = docs[0];
    else if (event.key === 'End') next = docs[docs.length - 1];
    else if (event.key === 'Delete') {
      event.preventDefault();
      void app.closeDocument(doc);
      return;
    }
    if (!next) return;
    event.preventDefault();
    focusTab(next);
  }

  function onTabAuxClick(event: MouseEvent, doc: EditorDoc): void {
    if (event.button !== 1) return;
    event.preventDefault();
    void app.closeDocument(doc);
  }

  /** A vertical wheel scrolls the strip sideways. */
  function onWheel(event: WheelEvent): void {
    if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    strip.scrollLeft += event.deltaY;
  }

  $effect(() => {
    const doc = app.doc;
    if (!doc) return;
    focusDoc = doc;
    const node = tabs.get(doc);
    if (node) reveal(node);
  });
</script>

<div class="tabbar">
  <div class="tabs" role="tablist" aria-label={t('chrome.tabs.label')} bind:this={strip} onwheel={onWheel}>
    {#each app.docs as doc (doc)}
      {@const active = doc === app.doc}
      {@const closeLabel = t('chrome.tabs.close', { name: doc.name })}
      <div class="tab" class:is-active={active}>
        <button
          type="button"
          class="tab-select"
          role="tab"
          aria-selected={active}
          tabindex={doc === stopDoc ? 0 : -1}
          use:register={doc}
          use:tooltip={{ text: doc.name }}
          onclick={() => app.selectDocument(doc)}
          onkeydown={(event) => onTabKey(event, doc)}
          onfocus={() => (focusDoc = doc)}
          onmousedown={(event) => event.button === 1 && event.preventDefault()}
          onauxclick={(event) => onTabAuxClick(event, doc)}
        >
          <span class="tab-name">{doc.name}</span>
          {#if doc.history.dirty}<span class="tab-dirty" role="img" aria-label={t('chrome.dirty')} use:tooltip={{ text: t('chrome.dirty') }}></span>{/if}
        </button>
        <button
          type="button"
          class="tab-close"
          tabindex="-1"
          aria-label={closeLabel}
          use:tooltip={{ text: closeLabel }}
          onclick={() => void app.closeDocument(doc)}
        >
          <X size={14} strokeWidth={2.75} />
        </button>
      </div>
    {/each}
  </div>
  <button type="button" class="icon-btn tab-open" aria-label={t('chrome.tabs.open')} use:tooltip={{ text: t('chrome.tabs.open') }} onclick={() => runAction('file.open', 'pointer')}>
    <Plus size={18} strokeWidth={2.5} />
  </button>
</div>

<style>
  @layer components {
    .tabbar {
      display: flex;
      align-items: end;
      gap: var(--space-1);
      min-width: 0;
      height: 40px;
      padding: 0 var(--space-2);
      background: var(--surface-sunken);
      border-bottom: 2px solid var(--line);
    }

    .tabs {
      position: relative;
      display: flex;
      align-items: end;
      gap: 2px;
      min-width: 0;
      height: 100%;
      padding-top: var(--space-1);
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }

    .tab {
      position: relative;
      display: flex;
      flex: none;
      align-items: center;
      max-width: 220px;
      height: 32px;
      margin-bottom: -2px;
      color: var(--text-faint);
      background: transparent;
      border: 2px solid transparent;
      border-bottom: 0;
      border-radius: var(--radius-s) var(--radius-s) 0 0;
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        color var(--dur-hover) var(--ease-sym);

      &:hover:not(.is-active) {
        color: var(--text);
        background: var(--surface-2);
      }

      &.is-active {
        z-index: 1;
        color: var(--text);
        background: var(--stage-bg);
        border-color: var(--line);
        /* Covers the bar edge under the active tab, so the tab opens into the stage below it. */
        box-shadow: 0 2px 0 var(--stage-bg);
      }
    }

    .tab-select {
      display: flex;
      flex: 1 1 auto;
      align-items: center;
      gap: var(--space-2);
      min-width: 0;
      height: 100%;
      padding: 0 var(--space-1) 0 var(--space-3);
      font-weight: 800;
      font-size: 0.875rem;
      color: inherit;
      border-radius: inherit;

      &:focus-visible {
        outline-offset: -3px;
      }
    }

    .tab-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tab-dirty {
      flex: none;
      width: 9px;
      height: 9px;
      background: var(--yellow);
      border-radius: var(--radius-pill);
      box-shadow: 0 0 0 3px color-mix(in oklch, var(--yellow) 18%, transparent);
      animation: dirty-in var(--dur-pop) var(--ease-spring);
    }

    .tab-close {
      display: inline-grid;
      flex: none;
      place-items: center;
      width: 22px;
      height: 22px;
      margin-right: var(--space-1);
      color: var(--text-faint);
      border-radius: var(--radius-s);
      transition:
        transform var(--dur-hover) var(--ease-spring),
        background-color var(--dur-hover) var(--ease-sym),
        color var(--dur-hover) var(--ease-sym);

      &:hover {
        color: var(--text);
        background: var(--surface-hover);
      }

      &:active {
        transform: translateY(1px) scale(0.94);
        transition-duration: 60ms;
      }
    }

    .tab-open {
      flex: none;
      align-self: center;
      width: 32px;
      height: 32px;
    }

    @keyframes dirty-in {
      from {
        scale: 0;
      }
    }
  }
</style>
