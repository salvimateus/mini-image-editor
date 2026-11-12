<script lang="ts">
  import Copy from '@lucide/svelte/icons/copy';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import ImagePlus from '@lucide/svelte/icons/image-plus';
  import Merge from '@lucide/svelte/icons/merge';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Trash from '@lucide/svelte/icons/trash';
  import Type from '@lucide/svelte/icons/type';
  import { backOut } from 'svelte/easing';
  import { actionEnabled, runAction } from '../../app/actions/index.ts';
  import type { EditorDoc } from '../../app/doc.svelte.ts';
  import { t } from '../../app/i18n/index.ts';
  import type { Layer } from '../../app/layers.ts';
  import { keyLabels, shortcutOf, type ActionId } from '../../app/shortcuts.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app, prefersReducedMotion } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import SliderField from '../base/SliderField.svelte';
  import { tooltip } from '../base/tooltip.ts';

  const ACTIONS: readonly { id: ActionId; icon: typeof Plus }[] = [
    { id: 'layer.new', icon: Plus },
    { id: 'layer.addImage', icon: ImagePlus },
    { id: 'layer.duplicate', icon: Copy },
    { id: 'layer.mergeDown', icon: Merge },
    { id: 'layer.delete', icon: Trash },
  ];

  const doc = $derived(app.doc);
  /** Top first, as the stage stacks them. */
  const rows = $derived(doc ? [...doc.layers].reverse() : []);
  const active = $derived(doc?.active ?? null);

  let thumbTick = $state(0);
  let editingId = $state<number | null>(null);
  let draft = $state('');
  let list = $state<HTMLOListElement | null>(null);

  interface RowDrag { id: number; pointerId: number; startY: number; from: number; moved: boolean; slot: number | null }
  let rowDrag = $state<RowDrag | null>(null);

  // Thumbnails follow the pixels a short time after a change, at most once in each delay.
  $effect(() => {
    const current = doc;
    if (!current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = current.onChange(() => {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        thumbTick += 1;
      }, TUNING.select.thumb.delayMs);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  });

  interface ThumbParams { doc: EditorDoc; layer: Layer; tick: number; w: number; h: number }

  /** The layer inside the stage, scaled down on the CPU with a few samples per thumbnail px. */
  function drawThumb(canvas: HTMLCanvasElement, { doc: owner, layer }: ThumbParams): void {
    const box = TUNING.select.thumb.sizePx;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const fit = Math.min(box / owner.width, box / owner.height);
    const cssW = Math.max(1, Math.round(owner.width * fit));
    const cssH = Math.max(1, Math.round(owner.height * fit));
    const pw = Math.max(1, Math.round(cssW * ratio));
    const ph = Math.max(1, Math.round(cssH * ratio));
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { image } = layer;
    const out = new Uint8ClampedArray(pw * ph * 4);
    const n = TUNING.select.thumb.samples;
    const sx = owner.width / pw;
    const sy = owner.height / ph;
    for (let j = 0; j < ph; j++) {
      for (let i = 0; i < pw; i++) {
        let a = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let v = 0; v < n; v++) {
          const ly = Math.floor((j + (v + 0.5) / n) * sy) - layer.y;
          if (ly < 0 || ly >= image.height) continue;
          for (let u = 0; u < n; u++) {
            const lx = Math.floor((i + (u + 0.5) / n) * sx) - layer.x;
            if (lx < 0 || lx >= image.width) continue;
            const o = (ly * image.width + lx) * 4;
            const alpha = image.data[o + 3];
            a += alpha;
            r += image.data[o] * alpha;
            g += image.data[o + 1] * alpha;
            b += image.data[o + 2] * alpha;
          }
        }
        if (a === 0) continue;
        const o = (j * pw + i) * 4;
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
        out[o + 3] = a / (n * n);
      }
    }
    ctx.putImageData(new ImageData(out, pw, ph), 0, 0);
  }

  function thumbnail(canvas: HTMLCanvasElement, params: ThumbParams) {
    drawThumb(canvas, params);
    return {
      update(next: ThumbParams) {
        drawThumb(canvas, next);
      },
      destroy() {
        canvas.width = 0;
        canvas.height = 0;
      },
    };
  }

  /** A short pop for a new row; nothing under reduced motion. */
  function pop(_node: Element) {
    return {
      duration: prefersReducedMotion() ? 0 : TUNING.select.rowPopMs,
      easing: backOut,
      css: (k: number) => `opacity: ${Math.min(1, k * 1.6)}; transform: scale(${0.9 + 0.1 * k});`,
    };
  }

  function focusSelect(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }

  function select(layer: Layer): void {
    if (!doc || doc.activeId === layer.id) return;
    doc.setActive(layer.id);
    sfx.play('tick');
  }

  /** A text layer opens the Text tool and panel; a generated layer opens its generator panel. */
  function canEdit(layer: Layer): boolean {
    return layer.kind === 'text' || (layer.kind === 'raster' && layer.generator !== undefined);
  }

  function openEditor(layer: Layer): void {
    if (!doc || !canEdit(layer)) return;
    if (doc.activeId !== layer.id) doc.setActive(layer.id);
    if (layer.kind === 'text') {
      if (app.tool === 'text') sfx.play('tick');
      app.setTool('text');
      app.openPanel('text');
    } else {
      runAction('adjust.vignette', 'pointer');
    }
  }

  function onRowDblClick(event: MouseEvent, layer: Layer): void {
    if ((event.target as HTMLElement).closest('.row-name, .row-eye, .row-edit, input')) return;
    openEditor(layer);
  }

  function toggleVisible(layer: Layer): void {
    doc?.setLayerProps(layer.id, { visible: !layer.visible });
    sfx.play('tick');
  }

  function startRename(layer: Layer): void {
    editingId = layer.id;
    draft = layer.name;
  }

  function commitRename(): void {
    const id = editingId;
    if (id === null || !doc) return;
    editingId = null;
    const layer = doc.layer(id);
    const name = draft.trim();
    if (!layer || !name || name === layer.name) return;
    doc.setLayerProps(id, { name });
    sfx.play('tick');
  }

  function onNameKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      editingId = null;
    }
  }

  function setOpacity(value: number): void {
    if (!doc || !active) return;
    doc.setLayerProps(active.id, { opacity: value / 100 }, 'opacity');
  }

  // ----- drag to reorder -----

  /** The insertion slot (0 = above the top row) under the pointer, or null when the drop would change nothing. */
  function slotAt(clientY: number, from: number): number | null {
    const items = list ? Array.from(list.querySelectorAll<HTMLElement>('.layer-row')) : [];
    let slot = items.length;
    for (let i = 0; i < items.length; i++) {
      const box = items[i].getBoundingClientRect();
      if (clientY < box.top + box.height / 2) {
        slot = i;
        break;
      }
    }
    return slot === from || slot === from + 1 ? null : slot;
  }

  function onRowDown(event: PointerEvent, layer: Layer, index: number): void {
    if (event.button !== 0 || editingId !== null) return;
    if ((event.target as HTMLElement).closest('.row-eye, .row-edit, input')) return;
    rowDrag = { id: layer.id, pointerId: event.pointerId, startY: event.clientY, from: index, moved: false, slot: null };
  }

  function onRowMove(event: PointerEvent): void {
    const current = rowDrag;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved) {
      if (Math.abs(event.clientY - current.startY) < TUNING.select.rowDragPx) return;
      // The capture starts with the drag, so a plain click or double-click keeps its own target.
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    rowDrag = { ...current, moved: true, slot: slotAt(event.clientY, current.from) };
  }

  function onRowUp(event: PointerEvent, layer: Layer): void {
    const current = rowDrag;
    if (!current || current.pointerId !== event.pointerId) return;
    rowDrag = null;
    if (!current.moved) {
      select(layer);
      return;
    }
    if (current.slot === null || !doc) return;
    const count = doc.layers.length;
    const display = current.slot > current.from ? current.slot - 1 : current.slot;
    doc.moveLayer(current.id, count - 1 - display);
    sfx.play('layer');
  }

  function onRowCancel(): void {
    rowDrag = null;
  }

  function actionDisabled(id: ActionId): boolean {
    return !actionEnabled(id) || (id !== 'layer.new' && id !== 'layer.addImage' && !active);
  }
</script>

{#if doc}
  <section class="side-panel layers-panel" aria-labelledby="panel-layers-title">
    <h2 id="panel-layers-title" class="section-title">{t('chrome.panel.layers')}</h2>

    <ol class="layer-list" aria-label={t('select.layers.list')} bind:this={list}>
      {#each rows as layer, index (layer.id)}
        {@const isActive = layer.id === doc.activeId}
        <li
          class="layer-row"
          class:is-active={isActive}
          class:is-hidden={!layer.visible}
          class:is-dragging={rowDrag?.id === layer.id && rowDrag.moved}
          class:drop-above={rowDrag?.slot === index}
          class:drop-below={rowDrag?.slot === rows.length && index === rows.length - 1}
          aria-current={isActive ? 'true' : undefined}
          in:pop
          onpointerdown={(event) => onRowDown(event, layer, index)}
          onpointermove={onRowMove}
          onpointerup={(event) => onRowUp(event, layer)}
          onpointercancel={onRowCancel}
          ondblclick={(event) => onRowDblClick(event, layer)}
        >
          <button
            type="button"
            class="row-eye"
            aria-pressed={layer.visible}
            aria-label={layer.visible ? t('select.layers.hide') : t('select.layers.show')}
            use:tooltip={{ text: layer.visible ? t('select.layers.hide') : t('select.layers.show') }}
            onclick={() => toggleVisible(layer)}
          >
            {#if layer.visible}<Eye size={16} />{:else}<EyeOff size={16} />{/if}
          </button>
          <span class="row-thumb" aria-hidden="true">
            <canvas use:thumbnail={{ doc, layer, tick: thumbTick, w: doc.width, h: doc.height }}></canvas>
          </span>
          {#if editingId === layer.id}
            <input
              class="text-input row-input"
              type="text"
              name="layer-name"
              aria-label={t('select.layers.nameField')}
              autocomplete="off"
              spellcheck="false"
              bind:value={draft}
              use:focusSelect
              onkeydown={onNameKey}
              onblur={commitRename}
            />
          {:else}
            <button
              type="button"
              class="row-name"
              use:tooltip={{ text: t('select.layers.renameTip') }}
              onclick={() => select(layer)}
              ondblclick={() => startRename(layer)}
              onkeydown={(event) => {
                if (event.key === 'F2') {
                  event.preventDefault();
                  startRename(layer);
                }
              }}
            >
              <span class="row-name-text">{layer.name}</span>
              {#if !layer.visible}<span class="visually-hidden">({t('select.layers.hidden')})</span>{/if}
            </button>
          {/if}
          {#if canEdit(layer)}
            {@const isText = layer.kind === 'text'}
            {@const editLabel = isText ? t('select.layers.editText') : t('select.layers.editGenerated')}
            <span class="row-tail">
              <span
                class="row-mark"
                class:is-generated={!isText}
                role="img"
                aria-label={isText ? t('select.layers.text') : t('select.layers.generated')}
                use:tooltip={{ text: isText ? t('select.layers.text') : t('select.layers.generated') }}
              >
                {#if isText}<Type size={14} strokeWidth={2.5} />{:else}<Sparkles size={14} strokeWidth={2.5} />{/if}
              </span>
              <button type="button" class="row-edit" aria-label={editLabel} use:tooltip={{ text: editLabel }} onclick={() => openEditor(layer)}>
                {#if isText}<Pencil size={14} strokeWidth={2.5} />{:else}<SlidersHorizontal size={14} strokeWidth={2.5} />{/if}
              </button>
            </span>
          {/if}
        </li>
      {/each}
    </ol>

    {#if active}
      {#key active.id}
        <SliderField
          id="layer-opacity"
          label={t('select.layers.opacity')}
          value={Math.round(active.opacity * 100)}
          min={0}
          max={100}
          step={1}
          unit="%"
          reset={100}
          oninput={setOpacity}
          onchange={setOpacity}
        />
      {/key}
    {/if}

    <div class="layer-actions" role="toolbar" aria-label={t('select.layers.actions')}>
      {#each ACTIONS as action (action.id)}
        {@const Icon = action.icon}
        {@const label = t(shortcutOf(action.id).label)}
        <button
          type="button"
          class="icon-btn layer-action"
          class:is-danger={action.id === 'layer.delete'}
          aria-label={label}
          disabled={actionDisabled(action.id)}
          use:tooltip={{ text: label, keys: keyLabels(action.id) }}
          onclick={() => runAction(action.id, 'pointer')}
        >
          <Icon size={18} strokeWidth={2.25} />
        </button>
      {/each}
    </div>
  </section>
{/if}

<style>
  @layer components {
    /* Each part keeps its natural height; only the list scrolls, inside its own limits. */
    .layers-panel {
      --row-h: 56px;
      --row-gap: var(--space-1);
      --list-pad: 6px;
      flex: none;
      grid-template-rows: auto auto auto auto;
    }

    .layer-list {
      display: grid;
      grid-auto-rows: var(--row-h);
      align-content: start;
      gap: var(--row-gap);
      min-height: calc(var(--row-h) * 2 + var(--row-gap) + var(--list-pad) * 2);
      max-height: calc(var(--row-h) * 6.5 + var(--row-gap) * 6 + var(--list-pad) * 2);
      margin: 0;
      padding: var(--list-pad) 2px;
      overflow-y: auto;
      overscroll-behavior: contain;
      list-style: none;
    }

    .layer-row {
      position: relative;
      display: grid;
      grid-template-columns: auto auto minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--row-h);
      padding: var(--space-1) var(--space-2);
      background: var(--surface-1);
      border: 2px solid var(--line);
      border-radius: var(--radius-m);
      touch-action: none;
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        border-color var(--dur-hover) var(--ease-sym),
        opacity var(--dur-hover) var(--ease-sym);

      &:hover {
        background: var(--surface-3);
      }

      &.is-active {
        background: var(--primary-fill);
        border-color: var(--primary-edge);
      }

      &.is-dragging {
        opacity: 0.55;
      }

      &.drop-above::before,
      &.drop-below::after {
        content: '';
        position: absolute;
        left: 6px;
        right: 6px;
        height: 3px;
        background: var(--primary);
        border-radius: var(--radius-pill);
        pointer-events: none;
      }

      &.drop-above::before {
        top: -5px;
      }

      &.drop-below::after {
        bottom: -5px;
      }
    }

    .row-eye {
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      color: var(--text-muted);
      border-radius: var(--radius-s);
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        color var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover {
        color: var(--text);
        background: var(--surface-2);
      }

      &:active {
        transform: scale(0.9);
        transition-duration: 60ms;
      }

      .is-hidden & {
        color: var(--text-faint);
      }
    }

    .row-thumb {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: var(--radius-s);
      background: var(--surface-sunken);

      & canvas {
        display: block;
        background: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 / 8px 8px;
        box-shadow: 0 0 0 1px var(--line);
      }

      .is-hidden & {
        opacity: 0.45;
      }
    }

    .row-name {
      min-width: 0;
      min-height: 32px;
      padding: 0 var(--space-1);
      color: var(--text);
      font-weight: 700;
      font-size: 0.875rem;
      text-align: left;
      border-radius: var(--radius-s);

      .is-hidden & {
        color: var(--text-faint);
      }
    }

    .row-name-text {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row-input {
      min-height: 32px;
      font-size: 0.875rem;
      font-weight: 700;
    }

    .row-tail {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
    }

    .row-edit {
      display: inline-grid;
      place-items: center;
      width: 26px;
      height: 26px;
      color: var(--text-muted);
      border-radius: var(--radius-s);
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        color var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover {
        color: var(--text);
        background: var(--surface-2);
      }

      &:active {
        transform: scale(0.9);
        transition-duration: 60ms;
      }
    }

    .row-mark {
      display: inline-grid;
      place-items: center;
      width: 22px;
      height: 22px;
      color: var(--teal);
      background: var(--surface-2);
      border-radius: var(--radius-pill);

      &.is-generated {
        color: var(--yellow);
      }
    }

    .layer-actions {
      display: flex;
      justify-content: space-between;
      gap: var(--space-1);
      padding-top: var(--space-2);
      border-top: 2px solid var(--line);
    }

    .layer-action {
      width: 36px;
      height: 36px;

      &.is-danger:hover:not(:disabled) {
        color: var(--danger-text);
      }
    }
  }
</style>
