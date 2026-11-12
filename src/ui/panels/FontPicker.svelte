<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Search from '@lucide/svelte/icons/search';
  import WifiOff from '@lucide/svelte/icons/wifi-off';
  import { onMount, tick } from 'svelte';
  import type { FontState } from '../../app/fonts/text-session.svelte.ts';
  import {
    BUNDLED_FAMILY,
    BUNDLED_INFO,
    FONT_CATEGORIES,
    cancelPreviews,
    familyStack,
    loadCatalog,
    previewFont,
    previewStyle,
    recentFamilies,
    type FontCategory,
    type FontFamilyInfo,
  } from '../../app/fonts/fonts.ts';
  import { t, type TextKey } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';
  import { TUNING } from '../../app/tuning/index.ts';

  interface Props {
    id: string;
    family: string;
    /** The load state of the chosen family. */
    status: FontState;
    onpick: (family: string) => void;
    onretry: () => void;
    /** Puts the focus in the search field on mount. */
    autofocus?: boolean;
  }

  let { id, family, status, onpick, onretry, autofocus = false }: Props = $props();

  type Row = { kind: 'header'; text: TextKey } | { kind: 'font'; info: FontFamilyInfo; recent: boolean };
  type Filter = 'all' | FontCategory;

  const CATEGORY_KEYS: Record<Filter, TextKey> = {
    all: 'text.picker.category.all',
    'sans-serif': 'text.picker.category.sans-serif',
    serif: 'text.picker.category.serif',
    display: 'text.picker.category.display',
    handwriting: 'text.picker.category.handwriting',
    monospace: 'text.picker.category.monospace',
  };
  const FILTERS: readonly Filter[] = ['all', ...FONT_CATEGORIES];
  const ROW = TUNING.text.pickerRowPx;
  const HEIGHT = TUNING.text.pickerHeightPx;
  const OVERSCAN = TUNING.text.pickerOverscan;

  let catalog = $state.raw<readonly FontFamilyInfo[] | null>(null);
  let query = $state('');
  let filter = $state<Filter>('all');
  let recent = $state.raw<string[]>(recentFamilies());
  let scrollTop = $state(0);
  let list = $state<HTMLDivElement | null>(null);
  let search = $state<HTMLInputElement | null>(null);

  function normalize(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  }

  const names = $derived(new Map((catalog ?? []).map((info) => [info.family, normalize(info.family)])));
  const byFamily = $derived(new Map((catalog ?? [BUNDLED_INFO]).map((info) => [info.family, info])));

  const rows = $derived.by((): Row[] => {
    const all = catalog ?? [BUNDLED_INFO];
    const needle = normalize(query);
    const fits = (info: FontFamilyInfo) => filter === 'all' || info.category === filter;
    const found = all.filter((info) => fits(info) && (!needle || (names.get(info.family) ?? '').includes(needle)));
    if (needle) return found.map((info) => ({ kind: 'font', info, recent: false }));
    const recentRows: Row[] = [];
    for (const name of recent) {
      const info = byFamily.get(name);
      if (info && fits(info)) recentRows.push({ kind: 'font', info, recent: true });
    }
    const out: Row[] = [];
    if (recentRows.length) out.push({ kind: 'header', text: 'text.picker.recent' }, ...recentRows, { kind: 'header', text: 'text.picker.all' });
    for (const info of found) out.push({ kind: 'font', info, recent: false });
    return out;
  });

  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN));
  const last = $derived(Math.min(rows.length, Math.ceil((scrollTop + HEIGHT) / ROW) + OVERSCAN));
  const visible = $derived(rows.slice(first, last).map((row, offset) => ({ row, index: first + offset })));
  const fontCount = $derived(catalog?.length ?? 0);
  const showStatus = $derived(family !== BUNDLED_FAMILY && (status === 'loading' || status === 'offline'));

  // The previews of the rows in view load once the scroll rests, so a fast fling does not ask for every row it passes.
  $effect(() => {
    const infos = visible.flatMap(({ row }) => (row.kind === 'font' ? [row.info] : []));
    const timer = setTimeout(() => {
      cancelPreviews(new Set(infos.map((info) => info.family)));
      for (const info of infos) previewFont(info);
    }, TUNING.text.previewSettleMs);
    return () => clearTimeout(timer);
  });

  onMount(() => {
    let alive = true;
    void loadCatalog().then((value) => {
      if (alive) catalog = value;
    });
    if (autofocus) void tick().then(() => search?.focus());
    return () => {
      alive = false;
      cancelPreviews(new Set());
    };
  });

  function onScroll(event: Event): void {
    scrollTop = (event.currentTarget as HTMLDivElement).scrollTop;
  }

  function setFilter(next: Filter): void {
    if (next === filter) return;
    sfx.play('tick');
    filter = next;
    resetScroll();
  }

  function onQuery(event: Event): void {
    query = (event.currentTarget as HTMLInputElement).value;
    resetScroll();
  }

  function resetScroll(): void {
    scrollTop = 0;
    if (list) list.scrollTop = 0;
  }

  function choose(info: FontFamilyInfo): void {
    sfx.play('tick');
    onpick(info.family);
    recent = [info.family, ...recent.filter((entry) => entry !== info.family)].slice(0, TUNING.text.recentMax);
  }

  function fontIndexFrom(start: number, direction: 1 | -1): number {
    for (let i = start; i >= 0 && i < rows.length; i += direction) if (rows[i].kind === 'font') return i;
    return -1;
  }

  /** Scrolls the row into view, then focuses it once it is rendered. */
  async function focusRow(index: number): Promise<void> {
    if (index < 0 || !list) return;
    const top = index * ROW;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW > list.scrollTop + HEIGHT) list.scrollTop = top + ROW - HEIGHT;
    scrollTop = list.scrollTop;
    await tick();
    list.querySelector<HTMLButtonElement>(`[data-index="${index}"]`)?.focus();
  }

  function onSearchKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      void focusRow(fontIndexFrom(0, 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const index = fontIndexFrom(0, 1);
      const row = rows[index];
      if (row?.kind === 'font') choose(row.info);
    }
  }

  function onRowKey(event: KeyboardEvent, index: number): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const next = fontIndexFrom(index + direction, direction);
      if (next >= 0) void focusRow(next);
      else if (direction === -1) search?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      void focusRow(event.key === 'Home' ? fontIndexFrom(0, 1) : fontIndexFrom(rows.length - 1, -1));
    }
  }

  function rowStyle(info: FontFamilyInfo): string {
    const style = previewStyle(info);
    return `font-family: ${familyStack(info.family)}; font-weight: ${style.weight}; font-style: ${style.italic ? 'italic' : 'normal'};`;
  }
</script>

<div class="picker">
  <label class="picker-search">
    <Search size={16} aria-hidden="true" />
    <span class="visually-hidden">{t('text.picker.search')}</span>
    <input
      bind:this={search}
      id="{id}-search"
      name="{id}-search"
      class="picker-search-input"
      type="search"
      autocomplete="off"
      spellcheck="false"
      placeholder={catalog ? t('text.picker.searchPlaceholder', { count: fontCount }) : t('text.picker.search')}
      value={query}
      oninput={onQuery}
      onkeydown={onSearchKey}
    />
  </label>

  <div class="picker-filters" role="group" aria-label={t('text.picker.categories')}>
    {#each FILTERS as entry (entry)}
      <button type="button" class="picker-chip" aria-pressed={filter === entry} onclick={() => setFilter(entry)}>
        {t(CATEGORY_KEYS[entry])}
      </button>
    {/each}
  </div>

  {#if showStatus}
    <p class="picker-status" class:is-offline={status === 'offline'} role="status">
      {#if status === 'loading'}
        <LoaderCircle class="picker-spin" size={16} aria-hidden="true" />
        {t('text.picker.loading')}
      {:else}
        <WifiOff size={16} aria-hidden="true" />
        <span class="picker-status-text">{t('text.picker.offline')}</span>
        <button type="button" class="btn btn-small btn-quiet" onclick={onretry}>{t('text.picker.retry')}</button>
      {/if}
    </p>
  {/if}

  <div bind:this={list} class="picker-list" style:height="{HEIGHT}px" onscroll={onScroll} aria-label={t('text.picker.list')} role="group">
    {#if !catalog}
      <p class="picker-empty">
        <LoaderCircle class="picker-spin" size={16} aria-hidden="true" />
        {t('text.picker.catalogLoading')}
      </p>
    {:else if rows.length === 0}
      <p class="picker-empty">{t('text.picker.none')}</p>
    {/if}
    <div class="picker-track" style:height="{rows.length * ROW}px">
      {#each visible as { row, index } (index)}
        {#if row.kind === 'header'}
          <div class="picker-header" style:height="{ROW}px" style:translate="0 {index * ROW}px">{t(row.text)}</div>
        {:else}
          {@const selected = row.info.family === family}
          <button
            type="button"
            class="picker-row"
            class:is-selected={selected}
            data-index={index}
            style:height="{ROW}px"
            style:translate="0 {index * ROW}px"
            aria-pressed={selected}
            onclick={() => choose(row.info)}
            onkeydown={(event) => onRowKey(event, index)}
          >
            <span class="picker-name" style={rowStyle(row.info)}>{row.info.family}</span>
            <span class="picker-meta">
              {#if row.info.family === BUNDLED_FAMILY}
                <span class="picker-tag">{t('text.picker.bundledTag')}</span>
              {/if}
              {#if selected && status === 'loading' && family !== BUNDLED_FAMILY}
                <LoaderCircle class="picker-spin" size={16} aria-label={t('text.picker.loading')} />
              {:else if selected && status === 'offline' && family !== BUNDLED_FAMILY}
                <WifiOff size={16} aria-label={t('text.picker.offline')} />
              {:else if selected}
                <Check size={16} aria-hidden="true" />
              {/if}
            </span>
          </button>
        {/if}
      {/each}
    </div>
  </div>

  <p class="picker-note">{t('text.picker.note')} {t('text.picker.bundled')}</p>
</div>

<style>
  @layer components {
    .picker {
      display: grid;
      gap: var(--space-2);
      min-width: 0;
    }

    .picker-search {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: 0 var(--space-2);
      color: var(--text-faint);
      background: var(--surface-sunken);
      border: 2px solid var(--line);
      border-radius: var(--radius-s);
      transition: border-color var(--dur-hover) var(--ease-sym);

      &:focus-within {
        border-color: var(--focus);
      }
    }

    .picker-search-input {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 34px;
      color: var(--text);
      background: transparent;
      border: 0;

      &:focus-visible {
        outline: none;
      }
    }

    .picker-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .picker-chip {
      min-height: 26px;
      padding: 0 var(--space-2);
      color: var(--text-muted);
      background: var(--surface-sunken);
      border: 1px solid var(--line);
      border-radius: var(--radius-pill);
      font: 800 0.75rem/1 var(--font-display);
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        color var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover:not([aria-pressed='true']) {
        color: var(--text);
        background: var(--surface-3);
      }

      &:active {
        transform: translateY(1px);
        transition-duration: 60ms;
      }

      &[aria-pressed='true'] {
        color: var(--on-primary);
        background: var(--primary);
        border-color: var(--primary-edge);
      }
    }

    .picker-status {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2);
      color: var(--text-muted);
      background: var(--surface-sunken);
      border-radius: var(--radius-s);
      font-size: 0.8125rem;
      font-weight: 700;
      line-height: 1.3;

      &.is-offline {
        color: var(--danger-text);
        border: 1px solid var(--danger-edge);
      }
    }

    .picker-status-text {
      flex: 1 1 auto;
      min-width: 0;
    }

    .picker-list {
      position: relative;
      overflow-y: auto;
      overscroll-behavior: contain;
      background: var(--surface-sunken);
      border: 2px solid var(--line);
      border-radius: var(--radius-s);
      contain: strict;
    }

    .picker-track {
      position: relative;
    }

    .picker-empty {
      position: absolute;
      inset: var(--space-3) var(--space-3) auto;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--text-faint);
      font-size: 0.8125rem;
      font-weight: 700;
    }

    :is(.picker-header, .picker-row) {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
    }

    .picker-header {
      display: flex;
      align-items: flex-end;
      padding: 0 var(--space-3) 6px;
      color: var(--text-faint);
      font: 800 0.6875rem/1 var(--font-display);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .picker-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      padding: 0 var(--space-3);
      color: var(--text);
      text-align: left;
      transition: background-color var(--dur-instant) var(--ease-sym);

      &:hover {
        background: var(--surface-2);
      }

      &:focus-visible {
        outline-offset: -3px;
      }

      &.is-selected {
        background: var(--primary-fill);
        color: var(--primary-hover);
      }
    }

    .picker-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 1.0625rem;
      line-height: 1.2;
    }

    .picker-meta {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: var(--space-2);
      color: var(--primary);
    }

    .picker-tag {
      padding: 2px 6px;
      color: var(--text-muted);
      background: var(--surface-3);
      border-radius: var(--radius-pill);
      font: 800 0.6875rem/1 var(--font-display);
    }

    .picker-note {
      color: var(--text-faint);
      font-size: 0.75rem;
      line-height: 1.35;
    }

    .picker :global(.picker-spin) {
      flex: none;
      animation: picker-spin 900ms linear infinite;
    }

    @keyframes picker-spin {
      to {
        rotate: 1turn;
      }
    }
  }
</style>
