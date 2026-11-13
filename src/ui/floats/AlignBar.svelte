<script lang="ts">
  import AlignHorizontalJustifyCenter from '@lucide/svelte/icons/align-horizontal-justify-center';
  import AlignHorizontalJustifyEnd from '@lucide/svelte/icons/align-horizontal-justify-end';
  import AlignHorizontalJustifyStart from '@lucide/svelte/icons/align-horizontal-justify-start';
  import AlignVerticalJustifyCenter from '@lucide/svelte/icons/align-vertical-justify-center';
  import AlignVerticalJustifyEnd from '@lucide/svelte/icons/align-vertical-justify-end';
  import AlignVerticalJustifyStart from '@lucide/svelte/icons/align-vertical-justify-start';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Frame from '@lucide/svelte/icons/frame';
  import Layers2 from '@lucide/svelte/icons/layers-2';
  import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import { untrack } from 'svelte';
  import { runAction } from '../../app/actions/index.ts';
  import {
    alignPicking,
    alignRefMode,
    alignTarget,
    alignTargetOf,
    cancelAlignPick,
    pickedName,
    setAlignRefHot,
    setAlignRefMode,
    setAlignRefPreview,
    type AlignRefMode,
  } from '../../app/align-reference.svelte.ts';
  import { t } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';
  import { shortcutOf, type ActionId } from '../../app/shortcuts.ts';
  import { app } from '../../app/state.svelte.ts';
  import { stageDragging } from '../../app/tools/marquee-rect.ts';
  import { layerBounds, transformOn } from '../../app/tools/move.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import PickerMenu from '../base/PickerMenu.svelte';
  import { tooltip } from '../base/tooltip.ts';

  const BUTTONS: readonly { id: ActionId; icon: typeof AlignHorizontalJustifyStart }[] = [
    { id: 'layer.alignLeft', icon: AlignHorizontalJustifyStart },
    { id: 'layer.alignCenterH', icon: AlignHorizontalJustifyCenter },
    { id: 'layer.alignRight', icon: AlignHorizontalJustifyEnd },
    { id: 'layer.alignTop', icon: AlignVerticalJustifyStart },
    { id: 'layer.alignCenterV', icon: AlignVerticalJustifyCenter },
    { id: 'layer.alignBottom', icon: AlignVerticalJustifyEnd },
  ];

  const ROW_ICONS: Record<AlignRefMode, typeof Sparkles> = { auto: Sparkles, below: Layers2, stage: Frame, pick: MousePointerClick };

  interface RefEntry {
    id: AlignRefMode;
    label: string;
    detail: string | null;
    disabled: boolean;
  }

  let bar = $state<HTMLDivElement | null>(null);
  let barW = $state(0);
  let barH = $state(0);
  let hover = $state(false);
  let focusIn = $state(false);
  let menuOpen = $state(false);

  const shown = $derived(app.tool === 'move' && !$stageDragging && !$transformOn);

  /** Above the visible bounds of the active layer, centered; below them when there is no room above. */
  const pos = $derived.by(() => {
    if (!shown) return null;
    void app.viewTick;
    const stage = app.stage;
    const doc = app.doc;
    const layer = doc?.active;
    if (!stage || !doc || !layer || !layer.visible) return null;
    const b = layerBounds(doc, layer);
    if (!b) return null;
    const { gapPx, edgePx } = TUNING.select.bar;
    const top = stage.docToScreen(b.x + b.w / 2, b.y);
    const bottom = stage.docToScreen(b.x + b.w / 2, b.y + b.h);
    const { width, height } = stage.viewport;
    let y = top.y - gapPx - barH;
    if (y < edgePx) y = bottom.y + gapPx;
    const x = Math.max(edgePx, Math.min(width - edgePx - barW, top.x - barW / 2));
    y = Math.max(edgePx, Math.min(height - edgePx - barH, y));
    return { x: Math.round(x), y: Math.round(y) };
  });

  const mode = $derived(alignRefMode());
  const picking = $derived(alignPicking());

  /** The chip names the object that an align uses now; a mode that cannot resolve shows what `auto` gives. */
  const chipText = $derived.by(() => {
    const doc = app.doc;
    if (picking) return t('select.align.ref.picking');
    if (!doc) return '';
    if (mode === 'stage') return t('select.align.ref.stage');
    if (mode === 'below' && alignTargetOf(doc, 'below')) return t('select.align.ref.below');
    return alignTarget(doc).name;
  });

  /** The details only matter while the menu is open. */
  const entries = $derived.by((): RefEntry[] => {
    const doc = app.doc;
    const open = menuOpen && doc;
    const below = open ? alignTargetOf(doc, 'below') : null;
    return [
      { id: 'auto', label: t('select.align.ref.auto'), detail: open ? (alignTargetOf(doc, 'auto')?.name ?? null) : null, disabled: false },
      { id: 'below', label: t('select.align.ref.below'), detail: open ? (below?.name ?? t('select.align.ref.none')) : null, disabled: open ? !below : false },
      { id: 'stage', label: t('select.align.ref.stage'), detail: null, disabled: false },
      { id: 'pick', label: t('select.align.ref.pick'), detail: open ? pickedName(doc) : null, disabled: false },
    ];
  });

  // The outline shows while the bar is in use; a hidden bar ends the hover and an armed pick.
  $effect(() => {
    const visible = pos !== null;
    const hot = visible && (hover || focusIn || menuOpen);
    untrack(() => {
      setAlignRefHot(hot);
      if (visible) return;
      menuOpen = false;
      hover = false;
      focusIn = false;
      setAlignRefPreview(null);
      cancelAlignPick();
    });
  });

  /** A press on the chip while a pick is armed cancels the pick and keeps the menu closed. */
  function onTrigger(): boolean {
    if (!alignPicking()) return false;
    cancelAlignPick();
    return true;
  }

  function stageBounds(): DOMRect | null {
    return bar?.closest('.stage')?.getBoundingClientRect() ?? null;
  }

  // Esc ends an armed pick before the tool or the shortcuts see it.
  function onKeyCapture(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !alignPicking() || event.defaultPrevented) return;
    event.preventDefault();
    sfx.play('tick');
    cancelAlignPick();
  }

  function onFocusOut(event: FocusEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (!target.contains(event.relatedTarget as Node | null)) focusIn = false;
  }
</script>

<svelte:window onkeydowncapture={onKeyCapture} />

{#if pos}
  <div
    bind:this={bar}
    class="align-bar"
    role="toolbar"
    tabindex="-1"
    aria-label={t('select.align.bar')}
    style:translate="{pos.x}px {pos.y}px"
    bind:offsetWidth={barW}
    bind:offsetHeight={barH}
    onpointerenter={() => (hover = true)}
    onpointerleave={() => (hover = false)}
    onfocusin={(event) => (focusIn = (event.target as Element).matches(':focus-visible'))}
    onfocusout={onFocusOut}
  >
    <span class="align-label" aria-hidden="true">{t('select.align.relativeTo')}</span>
    <PickerMenu
      label="{t('select.align.relativeTo')} {chipText}"
      title={t('select.align.ref.menu')}
      {entries}
      current={mode}
      onpick={setAlignRefMode}
      triggerClass={picking ? 'align-chip is-picking' : 'align-chip'}
      triggerTooltip={false}
      ontrigger={onTrigger}
      side="start"
      bounds={stageBounds}
      closeOnPick
      isDisabled={(entry) => entry.disabled}
      onopenchange={(open) => (menuOpen = open)}
      onpreview={setAlignRefPreview}
    >
      {#snippet icon()}
        <span class="align-chip-text">{chipText}</span>
        <ChevronDown size={14} strokeWidth={3} />
      {/snippet}
      {#snippet row(entry)}
        {@const Icon = ROW_ICONS[entry.id]}
        <Icon size={18} strokeWidth={2.25} />
        <span class="ref-name">{entry.label}</span>
        {#if entry.detail}<span class="ref-detail">{entry.detail}</span>{/if}
      {/snippet}
    </PickerMenu>
    <span class="align-sep" aria-hidden="true"></span>
    {#each BUTTONS as button, index (button.id)}
      {@const Icon = button.icon}
      {#if index === 3}<span class="align-sep" aria-hidden="true"></span>{/if}
      <button
        type="button"
        class="icon-btn align-btn"
        aria-label={t(shortcutOf(button.id).label)}
        use:tooltip={{ text: t(shortcutOf(button.id).label) }}
        onclick={() => runAction(button.id, 'pointer')}
      >
        <Icon size={18} strokeWidth={2.25} />
      </button>
    {/each}
  </div>
{/if}

<style>
  @layer components {
    .align-bar {
      position: absolute;
      top: 0;
      left: 0;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: var(--space-1);
      background: var(--surface-1);
      border: 2px solid var(--line-strong);
      border-radius: var(--radius-m);
      box-shadow: 0 4px 0 var(--depth);
      animation: align-in var(--dur-pop) var(--ease-spring);

      &:focus {
        outline: none;
      }
    }

    .align-label {
      padding-inline: var(--space-1) 4px;
      color: var(--text-muted);
      font: 700 0.75rem/1 var(--font-display);
      white-space: nowrap;
    }

    /* The chip is the trigger button of PickerMenu, so its class reaches it through :global. */
    .align-bar :global(.align-chip) {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 32px;
      padding: 0 var(--space-2);
      color: var(--text);
      background: var(--surface-2);
      border: 2px solid var(--line);
      border-radius: var(--radius-s);
      font: 800 0.8125rem/1 var(--font-display);
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        border-color var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover {
        background: var(--surface-3);
        border-color: var(--line-strong);
      }

      &:active {
        transform: translateY(1px) scale(0.97);
        transition-duration: 60ms;
      }
    }

    .align-bar :global(.align-chip[aria-expanded='true']),
    .align-bar :global(.align-chip.is-picking) {
      color: var(--primary);
      border-color: var(--primary);
    }

    .align-chip-text {
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* The look of the picker-name text of PickerMenu; the label stays whole and the detail takes the rest. */
    .ref-name {
      flex: none;
      white-space: nowrap;
      font: 800 0.9375rem/1.2 var(--font-display);
    }

    .ref-detail {
      flex: 1;
      min-width: 0;
      text-align: right;
      overflow: hidden;
      color: var(--text-faint);
      font: 700 0.75rem/1.2 var(--font-display);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .align-btn {
      width: 32px;
      height: 32px;
      border-radius: var(--radius-s);
    }

    .align-sep {
      width: 2px;
      height: 20px;
      margin: 0 var(--space-1);
      background: var(--line);
      border-radius: 1px;
    }

    @keyframes align-in {
      from {
        opacity: 0;
        scale: 0.92;
      }
    }
  }
</style>
