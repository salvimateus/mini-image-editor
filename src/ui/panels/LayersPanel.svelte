<script lang="ts">
  import CircleDot from '@lucide/svelte/icons/circle-dot';
  import Copy from '@lucide/svelte/icons/copy';
  import Eye from '@lucide/svelte/icons/eye';
  import Frame from '@lucide/svelte/icons/frame';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import ImagePlus from '@lucide/svelte/icons/image-plus';
  import Merge from '@lucide/svelte/icons/merge';
  import Pencil from '@lucide/svelte/icons/pencil';
  import PenTool from '@lucide/svelte/icons/pen-tool';
  import Plus from '@lucide/svelte/icons/plus';
  import Shapes from '@lucide/svelte/icons/shapes';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Trash from '@lucide/svelte/icons/trash';
  import Type from '@lucide/svelte/icons/type';
  import { tick, untrack } from 'svelte';
  import { backOut } from 'svelte/easing';
  import { actionEnabled, runAction } from '../../app/actions/index.ts';
  import type { EditorDoc } from '../../app/doc.svelte.ts';
  import { t, type TextKey } from '../../app/i18n/index.ts';
  import type { Layer } from '../../app/layers.ts';
  import { keyLabels, shortcutOf, type ActionId } from '../../app/shortcuts.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app, prefersReducedMotion } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import { uiZoom } from '../../app/ui-size.svelte.ts';
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

  /** A press on a row; it becomes a drag after a short distance. `ids` is the row order at the press. */
  interface RowDrag { id: number; pointerId: number; row: HTMLElement; startY: number; startScroll: number; clientY: number; from: number; ids: string; step: number; moved: boolean }
  /** What the rows draw during a drag: the offset of the lifted row and the display index where it would land. */
  interface SortView { id: number; from: number; target: number; dy: number; step: number }

  let rowDrag: RowDrag | null = null;
  let sortView = $state.raw<SortView | null>(null);
  /** The dropped row keeps its lifted look until it settles in its slot. */
  let settlingId = $state<number | null>(null);
  let settleAnims: Animation[] = [];
  let scrollFrame = 0;

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
    const ratio = Math.min(2, (window.devicePixelRatio || 1) * uiZoom());
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

  /** A plain click: the layer becomes active and the only selected layer. */
  function select(layer: Layer): void {
    if (!doc || (doc.activeId === layer.id && doc.selectedIds.length < 2)) return;
    doc.setActive(layer.id);
    sfx.play('tick');
  }

  function hasSelectKey(event: MouseEvent): boolean {
    return event.ctrlKey || event.metaKey || event.shiftKey;
  }

  /** Ctrl (or Cmd) + click adds or takes out one layer; Shift + click selects the range from the active layer. */
  function selectWithKeys(event: MouseEvent, layer: Layer): void {
    if (!doc || editingId !== null || rowDrag || sortView) return;
    const before = doc.selectedIds;
    if (event.shiftKey) doc.selectRange(layer.id);
    else doc.toggleSelected(layer.id);
    if (doc.selectedIds !== before) sfx.play('tick');
  }

  /** edit = the button that opens the editor of the layer; null for a kind with no editor (an SVG layer). */
  interface EditorMeta { mark: typeof Type; markLabel: TextKey; tone: 'text' | 'shape' | 'svg' | 'generated'; edit: { icon: typeof Pencil; label: TextKey } | null }

  /** The kind mark of a layer and the edit button of its editor; null for a plain raster layer. */
  function editorMeta(layer: Layer): EditorMeta | null {
    if (layer.kind === 'text') return { mark: Type, markLabel: 'select.layers.text', tone: 'text', edit: { icon: Pencil, label: 'select.layers.editText' } };
    if (layer.kind === 'shape') {
      return layer.spec.kind === 'step'
        ? { mark: CircleDot, markLabel: 'select.layers.step', tone: 'shape', edit: { icon: Pencil, label: 'select.layers.editStep' } }
        : { mark: Shapes, markLabel: 'select.layers.shape', tone: 'shape', edit: { icon: Pencil, label: 'select.layers.editShape' } };
    }
    if (layer.kind === 'svg') return { mark: PenTool, markLabel: 'select.layers.svg', tone: 'svg', edit: null };
    if (layer.generator?.kind === 'frame') return { mark: Frame, markLabel: 'select.layers.frame', tone: 'generated', edit: { icon: SlidersHorizontal, label: 'select.layers.editFrame' } };
    if (layer.generator) return { mark: Sparkles, markLabel: 'select.layers.generated', tone: 'generated', edit: { icon: SlidersHorizontal, label: 'select.layers.editGenerated' } };
    return null;
  }

  /** Makes the layer active and opens its editor: the tool of a text or shape layer, the panel of a generated layer. */
  function openEditor(layer: Layer): void {
    if (!doc || !editorMeta(layer)?.edit) return;
    if (doc.activeId !== layer.id) doc.setActive(layer.id);
    if (layer.kind === 'text') {
      if (app.tool === 'text') sfx.play('tick');
      app.setTool('text');
      app.openPanel('text');
    } else if (layer.kind === 'shape') {
      const tool = layer.spec.kind === 'step' ? 'step' : 'shape';
      if (app.tool === tool) sfx.play('tick');
      app.setTool(tool);
    } else if (layer.kind === 'raster' && layer.generator) {
      runAction(layer.generator.kind === 'frame' ? 'adjust.frame' : 'adjust.vignette', 'pointer');
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

  const rowIds = (): string => rows.map((layer) => layer.id).join(',');

  function liftScale(): number {
    return prefersReducedMotion() ? 1 : TUNING.select.rowDrag.liftScale;
  }

  function rowTransform(id: number, index: number): string | undefined {
    const view = sortView;
    if (!view) return undefined;
    if (id === view.id) return `translateY(${view.dy}px) scale(${liftScale()})`;
    if (view.from < view.target && index > view.from && index <= view.target) return `translateY(${-view.step}px)`;
    if (view.target < view.from && index >= view.target && index < view.from) return `translateY(${view.step}px)`;
    return undefined;
  }

  function rowElements(): HTMLElement[] {
    return list ? Array.from(list.querySelectorAll<HTMLElement>('.layer-row')) : [];
  }

  function stopSettle(): void {
    for (const anim of settleAnims) anim.finish();
    settleAnims = [];
  }

  /** The lifted row follows the pointer inside the list; the target slot is the nearest row position. */
  function updateView(current: RowDrag): void {
    const count = current.ids.split(',').length;
    const scroll = list ? list.scrollTop - current.startScroll : 0;
    const raw = (current.clientY - current.startY) / uiZoom() + scroll;
    const dy = Math.min((count - 1 - current.from) * current.step, Math.max(-current.from * current.step, raw));
    const target = Math.min(count - 1, Math.max(0, Math.round(current.from + dy / current.step)));
    if (sortView && sortView.target !== target) sfx.play('tick');
    sortView = { id: current.id, from: current.from, target, dy, step: current.step };
  }

  function autoScroll(): void {
    scrollFrame = 0;
    const current = rowDrag;
    if (!current?.moved || !list) return;
    const box = list.getBoundingClientRect();
    const { edgePx, scrollPxPerFrame } = TUNING.select.rowDrag;
    let speed = 0;
    if (current.clientY < box.top + edgePx) speed = -Math.min(1, (box.top + edgePx - current.clientY) / edgePx);
    else if (current.clientY > box.bottom - edgePx) speed = Math.min(1, (current.clientY - box.bottom + edgePx) / edgePx);
    if (speed !== 0) {
      const before = list.scrollTop;
      list.scrollTop = before + speed * scrollPxPerFrame;
      if (list.scrollTop !== before) updateView(current);
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  /** FLIP: each row starts at the place where it was drawn and slides to its new place. */
  async function settle(centers: Map<number, number>, liftedId: number): Promise<void> {
    await tick();
    if (!list || prefersReducedMotion()) {
      settlingId = null;
      return;
    }
    const style = getComputedStyle(list);
    const { shiftMs, settleMs } = TUNING.select.rowDrag;
    let liftedAnim: Animation | null = null;
    for (const row of rowElements()) {
      const id = Number(row.dataset.id);
      const before = centers.get(id);
      if (before === undefined) continue;
      const box = row.getBoundingClientRect();
      const dy = (before - (box.top + box.height / 2)) / uiZoom();
      const lifted = id === liftedId;
      if (!lifted && Math.abs(dy) < 0.5) continue;
      const anim = row.animate([{ transform: `translateY(${dy}px)${lifted ? ` scale(${liftScale()})` : ''}` }, { transform: 'none' }], {
        duration: lifted ? settleMs : shiftMs,
        easing: style.getPropertyValue(lifted ? '--ease-out' : '--ease-sym').trim() || 'ease-out',
      });
      settleAnims.push(anim);
      if (lifted) liftedAnim = anim;
    }
    const done = () => {
      if (settlingId === liftedId) settlingId = null;
    };
    if (liftedAnim) liftedAnim.finished.then(done, done);
    else done();
  }

  /** Ends a drag; `commit` moves the layer when its slot changed. One move is one undo step. */
  function endDrag(commit: boolean): void {
    const current = rowDrag;
    const view = sortView;
    rowDrag = null;
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    if (!current?.moved || !view) {
      sortView = null;
      return;
    }
    if (current.row.hasPointerCapture(current.pointerId)) current.row.releasePointerCapture(current.pointerId);
    const centers = new Map<number, number>();
    for (const row of rowElements()) {
      const box = row.getBoundingClientRect();
      centers.set(Number(row.dataset.id), box.top + box.height / 2);
    }
    settlingId = current.id;
    sortView = null;
    if (commit && doc && view.target !== view.from && rowIds() === current.ids) {
      doc.moveLayer(current.id, doc.layers.length - 1 - view.target);
      sfx.play('layer');
    }
    void settle(centers, current.id);
  }

  function onRowDown(event: PointerEvent, layer: Layer, index: number): void {
    if (event.button !== 0 || editingId !== null || rowDrag) return;
    if ((event.target as HTMLElement).closest('.row-eye, .row-edit, input')) return;
    // A selection press never starts a drag; no default keeps Shift from selecting the row text.
    if (hasSelectKey(event)) {
      event.preventDefault();
      selectWithKeys(event, layer);
      return;
    }
    rowDrag = {
      id: layer.id,
      pointerId: event.pointerId,
      row: event.currentTarget as HTMLElement,
      startY: event.clientY,
      startScroll: list?.scrollTop ?? 0,
      clientY: event.clientY,
      from: index,
      ids: rowIds(),
      step: 0,
      moved: false,
    };
  }

  function onRowMove(event: PointerEvent): void {
    const current = rowDrag;
    if (!current || current.pointerId !== event.pointerId) return;
    current.clientY = event.clientY;
    if (!current.moved) {
      if (Math.abs(event.clientY - current.startY) < TUNING.select.rowDrag.startPx) return;
      stopSettle();
      settlingId = null;
      const items = rowElements();
      current.step = items.length > 1 ? items[1].offsetTop - items[0].offsetTop : current.row.offsetHeight;
      current.moved = true;
      // The capture starts with the drag, so a plain click or double-click keeps its own target.
      current.row.setPointerCapture(event.pointerId);
      scrollFrame = requestAnimationFrame(autoScroll);
    }
    event.preventDefault();
    updateView(current);
  }

  function onRowUp(event: PointerEvent, layer: Layer): void {
    const current = rowDrag;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved) {
      rowDrag = null;
      select(layer);
      return;
    }
    endDrag(true);
  }

  /** A lost capture or a cancelled pointer drops the drag; the rows slide back. */
  function onRowCancel(event: PointerEvent): void {
    if (rowDrag?.pointerId === event.pointerId) endDrag(false);
  }

  // Escape cancels a drag before any other key handler sees it.
  const sorting = $derived(sortView !== null);

  $effect(() => {
    if (!sorting) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      endDrag(false);
      sfx.play('cancel');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // A change of the layer order or of the document under a drag (undo, a new layer, a tab switch) drops it.
  $effect(() => {
    const ids = rowIds();
    untrack(() => {
      if (rowDrag && rowDrag.ids !== ids) endDrag(false);
    });
  });

  $effect(() => () => {
    cancelAnimationFrame(scrollFrame);
    stopSettle();
  });

  function actionDisabled(id: ActionId): boolean {
    return !actionEnabled(id) || (id !== 'layer.new' && id !== 'layer.addImage' && !active);
  }
</script>

{#if doc}
  <section class="side-panel layers-panel" aria-labelledby="panel-layers-title">
    <h2 id="panel-layers-title" class="section-title">{t('chrome.panel.layers')}</h2>

    <ol
      class="layer-list"
      class:is-sorting={sorting}
      aria-label={t('select.layers.list')}
      style:--row-shift-ms={`${TUNING.select.rowDrag.shiftMs}ms`}
      bind:this={list}
    >
      {#each rows as layer, index (layer.id)}
        {@const isActive = layer.id === doc.activeId}
        {@const isSelected = !isActive && doc.isSelected(layer.id)}
        {@const meta = editorMeta(layer)}
        <li
          class="layer-row"
          class:is-active={isActive}
          class:is-selected={isSelected}
          class:is-hidden={!layer.visible}
          class:is-lifted={sortView?.id === layer.id || settlingId === layer.id}
          data-id={layer.id}
          style:transform={rowTransform(layer.id, index)}
          aria-current={isActive ? 'true' : undefined}
          in:pop
          onpointerdown={(event) => onRowDown(event, layer, index)}
          onpointermove={onRowMove}
          onpointerup={(event) => onRowUp(event, layer)}
          onpointercancel={onRowCancel}
          onlostpointercapture={onRowCancel}
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
          <span class="row-thumb">
            <canvas aria-hidden="true" use:thumbnail={{ doc, layer, tick: thumbTick, w: doc.width, h: doc.height }}></canvas>
            {#if meta}
              {@const Mark = meta.mark}
              <span
                class="row-mark"
                class:is-generated={meta.tone === 'generated'}
                class:is-shape={meta.tone === 'shape'}
                class:is-svg={meta.tone === 'svg'}
                role="img"
                aria-label={t(meta.markLabel)}
                use:tooltip={{ text: t(meta.markLabel) }}
              >
                <Mark size={11} strokeWidth={2.75} />
              </span>
            {/if}
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
              use:tooltip={{ text: t('select.layers.nameTip', { name: layer.name }) }}
              onclick={(event) => {
                // A pointer click with a key already selected on the press; a key press (detail 0) selects here.
                if (!hasSelectKey(event)) select(layer);
                else if (event.detail === 0) selectWithKeys(event, layer);
              }}
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
              {#if isSelected}<span class="visually-hidden">({t('select.layers.selected')})</span>{/if}
            </button>
          {/if}
          {#if meta?.edit}
            {@const Edit = meta.edit.icon}
            {@const editLabel = meta.edit.label}
            <button type="button" class="row-edit" aria-label={t(editLabel)} use:tooltip={{ text: t(editLabel) }} onclick={() => openEditor(layer)}>
              <Edit size={14} strokeWidth={2.5} />
            </button>
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

      /* A selected row that is not the active one: a lighter tint and a dashed edge. */
      &.is-selected {
        background: color-mix(in oklch, var(--primary-fill) 50%, var(--surface-1));
        border-style: dashed;
        border-color: var(--primary-edge);
      }

      &.is-active {
        background: var(--primary-fill);
        border-color: var(--primary-edge);
      }

      /* The lift shadow fades in and out on its own layer, so the row never animates box-shadow. */
      &::after {
        content: '';
        position: absolute;
        inset: -2px;
        border-radius: inherit;
        box-shadow: 0 6px 0 var(--depth);
        opacity: 0;
        pointer-events: none;
        transition: opacity var(--dur-pop) var(--ease-sym);
      }

      &.is-lifted {
        z-index: 1;
        cursor: grabbing;

        &::after {
          opacity: 1;
        }
      }
    }

    /* During a drag the other rows slide out of the way; the lifted row follows the pointer with no delay. */
    .layer-list.is-sorting {
      cursor: grabbing;
      user-select: none;

      & .layer-row:not(.is-lifted) {
        transition:
          transform var(--row-shift-ms) var(--ease-sym),
          background-color var(--dur-hover) var(--ease-sym),
          border-color var(--dur-hover) var(--ease-sym),
          opacity var(--dur-hover) var(--ease-sym);
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
      position: relative;
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

    /* The kind badge sits on the thumbnail corner, so the name keeps the free width of the row. */
    .row-mark {
      position: absolute;
      right: -4px;
      bottom: -4px;
      display: inline-grid;
      place-items: center;
      width: 18px;
      height: 18px;
      color: var(--teal);
      background: var(--surface-1);
      border: 2px solid var(--line-strong);
      border-radius: var(--radius-pill);

      &.is-generated {
        color: var(--yellow);
      }

      &.is-shape {
        color: var(--pink);
      }

      &.is-svg {
        color: var(--primary);
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
