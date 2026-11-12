<script lang="ts">
  import Lock from '@lucide/svelte/icons/lock';
  import LockOpen from '@lucide/svelte/icons/lock-open';
  import { onMount, untrack } from 'svelte';
  import { ratioLabel } from '../../app/aspect.ts';
  import { t, type TextKey } from '../../app/i18n/index.ts';
  import { app } from '../../app/state.svelte.ts';
  import { cropSession, type CropFill, type CropMode } from '../../app/tools/crop.ts';
  import { tooltip } from '../base/tooltip.ts';
  import Keys from '../base/Keys.svelte';

  const MODES: readonly { id: CropMode; label: TextKey; hint: TextKey }[] = [
    { id: 'crop', label: 'geometry.crop.modeCrop', hint: 'geometry.crop.modeCropHint' },
    { id: 'expand', label: 'geometry.crop.modeExpand', hint: 'geometry.crop.modeExpandHint' },
  ];
  const FILLS: readonly { id: CropFill; label: TextKey }[] = [
    { id: 'transparent', label: 'geometry.fill.transparent' },
    { id: 'fg', label: 'geometry.fill.fg' },
    { id: 'bg', label: 'geometry.fill.bg' },
  ];

  let tick = $state(0);
  let widthDraft = $state<string | null>(null);
  let heightDraft = $state<string | null>(null);

  onMount(() => cropSession.subscribe(() => (tick += 1)));

  // A ratio button of the aspect bar, also while the crop tool is already active.
  $effect(() => {
    const request = app.cropRequest;
    untrack(() => cropSession.useRequest(request));
  });

  const view = $derived.by(() => {
    void tick;
    // An undo or a redo changes the stage size; the session starts again from it.
    void app.doc?.width;
    void app.doc?.height;
    return { box: cropSession.box, ratio: cropSession.ratio, mode: cropSession.mode, fill: cropSession.fill, applying: cropSession.applying };
  });

  const lockText = $derived(view.ratio ? ratioLabel(view.ratio.w * 100, view.ratio.h * 100).text : t('geometry.crop.free'));

  function parseSide(text: string): number | null {
    const clean = text.trim();
    if (!/^\d+$/.test(clean)) return null;
    const value = Number(clean);
    return value >= 1 ? value : null;
  }

  function commit(axis: 'w' | 'h'): void {
    const draft = axis === 'w' ? widthDraft : heightDraft;
    if (axis === 'w') widthDraft = null;
    else heightDraft = null;
    if (draft === null) return;
    const value = parseSide(draft);
    if (value === null) return;
    if (axis === 'w') cropSession.setSize(value, null);
    else cropSession.setSize(null, value);
  }

  function onFieldKey(event: KeyboardEvent, axis: 'w' | 'h'): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(axis);
      (event.currentTarget as HTMLInputElement).blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (axis === 'w') widthDraft = null;
      else heightDraft = null;
      (event.currentTarget as HTMLInputElement).blur();
    }
  }

  function fillSwatch(id: CropFill): string {
    if (id === 'transparent') return '';
    const color = id === 'fg' ? app.fg : app.bg;
    return `rgb(${color.r} ${color.g} ${color.b})`;
  }
</script>

{#if view.box}
  <div class="crop-options">
    <div class="sides">
      <label class="side">
        <span class="side-label">{t('geometry.width')}</span>
        <input
          class="number-input side-input"
          name="crop-width"
          inputmode="numeric"
          autocomplete="off"
          value={widthDraft ?? String(view.box.w)}
          oninput={(event) => (widthDraft = event.currentTarget.value)}
          onblur={() => commit('w')}
          onkeydown={(event) => onFieldKey(event, 'w')}
        />
      </label>
      <span class="times" aria-hidden="true">×</span>
      <label class="side">
        <span class="side-label">{t('geometry.height')}</span>
        <input
          class="number-input side-input"
          name="crop-height"
          inputmode="numeric"
          autocomplete="off"
          value={heightDraft ?? String(view.box.h)}
          oninput={(event) => (heightDraft = event.currentTarget.value)}
          onblur={() => commit('h')}
          onkeydown={(event) => onFieldKey(event, 'h')}
        />
      </label>
      <button
        type="button"
        class="btn btn-small lock"
        aria-pressed={view.ratio !== null}
        use:tooltip={{ text: view.ratio ? t('geometry.crop.unlockHint') : t('geometry.crop.lockHint') }}
        onclick={() => cropSession.toggleLock()}
      >
        {#if view.ratio}<Lock size={14} strokeWidth={2.5} />{:else}<LockOpen size={14} strokeWidth={2.5} />{/if}
        {lockText}
      </button>
    </div>

    <div class="segmented compact" role="group" aria-label={t('geometry.crop.mode')}>
      {#each MODES as entry (entry.id)}
        <button type="button" aria-pressed={view.mode === entry.id} use:tooltip={{ text: t(entry.hint) }} onclick={() => cropSession.setMode(entry.id)}>
          {t(entry.label)}
        </button>
      {/each}
    </div>

    <div class="segmented compact" role="group" aria-label={t('geometry.fill.label')}>
      {#each FILLS as entry (entry.id)}
        <button type="button" aria-pressed={view.fill === entry.id} onclick={() => cropSession.setFill(entry.id)}>
          <span class="swatch" class:swatch-transparent={entry.id === 'transparent'} style:background={fillSwatch(entry.id) || null} aria-hidden="true"></span>
          {t(entry.label)}
        </button>
      {/each}
    </div>

    <div class="actions">
      <button type="button" class="btn btn-small btn-quiet" use:tooltip={{ text: t('geometry.hint.cropCancel'), keys: ['Esc'] }} onclick={() => cropSession.cancel()}>
        {t('common.cancel')}
        <Keys keys={['Esc']} />
      </button>
      <button
        type="button"
        class="btn btn-small btn-primary"
        disabled={view.applying}
        use:tooltip={{ text: t('geometry.hint.cropApply'), keys: ['Enter'] }}
        onclick={() => void cropSession.apply()}
      >
        {t('geometry.apply')}
        <Keys keys={['Enter']} />
      </button>
    </div>
  </div>
{/if}

<style>
  @layer components {
    .crop-options {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: max-content;
    }

    .sides {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    .side {
      display: flex;
      align-items: center;
      gap: var(--space-1);
    }

    .side-label {
      color: var(--text-faint);
      font-size: 0.75rem;
      font-weight: 800;
    }

    .side-input {
      width: 4.25rem;
      min-height: 30px;
    }

    .times {
      color: var(--text-faint);
      font-weight: 800;
    }

    .lock {
      min-width: 5.5rem;
      font-variant-numeric: tabular-nums;

      &[aria-pressed='true'] {
        color: var(--on-primary);
        background: var(--primary);
        border-color: var(--primary-edge);
        --btn-depth: var(--primary-depth);
      }
    }

    .compact {
      padding: 2px;

      & button {
        min-height: 26px;
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
      }
    }

    .swatch {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 1px solid var(--line-strong);
      border-radius: 3px;
    }

    .swatch-transparent {
      background: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 / 6px 6px;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
  }
</style>
