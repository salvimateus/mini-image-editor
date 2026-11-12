<script lang="ts">
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import { onMount } from 'svelte';
  import { runAction } from '../app/actions/index.ts';
  import type { GridSpec } from '../app/doc.svelte.ts';
  import { t } from '../app/i18n/index.ts';
  import * as sfx from '../app/sfx.ts';
  import { clearSnapFeedback, snapValueLive } from '../app/snap-feedback.svelte.ts';
  import { app } from '../app/state.svelte.ts';
  import { TUNING } from '../app/tuning/index.ts';
  import ToggleSwitch from './base/ToggleSwitch.svelte';
  import { tooltip } from './base/tooltip.ts';
  import { cleanGuidePos, guideKept, setRulerGuide } from './overlays/guides.ts';
  import { loadStageColors, STAGE_COLORS } from './stage-renderer.ts';

  interface Props {
    /** 'x': the horizontal ruler above the stage; 'y': the vertical ruler at its left. */
    axis: 'x' | 'y';
  }

  let { axis }: Props = $props();

  const FONT = `800 ${TUNING.geometry.rulers.fontPx}px 'Nunito Variable', 'Nunito', system-ui, sans-serif`;
  /** The horizontal ruler makes horizontal guides (a y position), as in most editors; the vertical ruler makes vertical ones. */
  const guideAxis = $derived<'x' | 'y'>(axis === 'x' ? 'y' : 'x');

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let settingsButton = $state<HTMLButtonElement | null>(null);
  let popover = $state<HTMLDivElement | null>(null);
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let raf = 0;
  /** The pointer in client px while it is over the stage, or null. */
  let pointer: { x: number; y: number } | null = null;
  let dragging = false;
  let settingsOpen = $state(false);
  let popoverPos = $state({ top: 0, right: 0 });

  function stageCell(): HTMLElement | null {
    return wrap?.closest('.editor-stage')?.querySelector<HTMLElement>('.stage-cell') ?? null;
  }

  function schedule(): void {
    if (!raf) raf = requestAnimationFrame(draw);
  }

  /** The largest of 1, 2, 5 × 10^k document px that keeps labeled ticks at least the minimum apart on screen. */
  function niceStep(zoom: number): number {
    const raw = TUNING.geometry.rulers.labelMinPx / Math.max(zoom, 1e-6);
    const base = 10 ** Math.floor(Math.log10(raw));
    for (const k of [1, 2, 5, 10]) if (base * k >= raw) return Math.max(1, base * k);
    return Math.max(1, base * 10);
  }

  function minorStep(step: number, zoom: number): number | null {
    for (const parts of [10, 5, 2]) {
      const minor = step / parts;
      if (minor >= 1 && minor * zoom >= TUNING.geometry.rulers.minorMinPx) return minor;
    }
    return null;
  }

  function draw(): void {
    raf = 0;
    const ctx = canvas?.getContext('2d');
    if (!ctx || cssW <= 0 || cssH <= 0) return;
    loadStageColors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = STAGE_COLORS.ruler;
    ctx.fillRect(0, 0, cssW, cssH);
    const horizontal = axis === 'x';
    const length = horizontal ? cssW : cssH;
    const depth = horizontal ? cssH : cssW;
    const stage = app.stage;
    const doc = app.doc;
    const cell = stageCell();
    if (stage && doc && cell) {
      const camera = stage.camera;
      const own = canvas.getBoundingClientRect();
      const cellBox = cell.getBoundingClientRect();
      const offset = horizontal ? cellBox.left - own.left : cellBox.top - own.top;
      const pan = (horizontal ? camera.panX : camera.panY) + offset;
      const zoom = camera.zoom;
      const toScreen = (pos: number): number => pan + pos * zoom;
      const size = horizontal ? doc.width : doc.height;

      // The stage span is a little lighter, so the ruler shows where the image is.
      const s0 = Math.max(0, toScreen(0));
      const s1 = Math.min(length, toScreen(size));
      if (s1 > s0) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = STAGE_COLORS.grid;
        if (horizontal) ctx.fillRect(s0, 0, s1 - s0, depth);
        else ctx.fillRect(0, s0, depth, s1 - s0);
        ctx.globalAlpha = 1;
      }

      const step = niceStep(zoom);
      const minor = minorStep(step, zoom);
      const from = (0 - pan) / zoom;
      const to = (length - pan) / zoom;
      const line = 1 / dpr;
      const crisp = (value: number): number => (Math.round(value * dpr) + 0.5) / dpr;

      ctx.beginPath();
      if (minor) {
        for (let n = Math.ceil(from / minor); n * minor <= to; n++) {
          const pos = n * minor;
          if (Math.abs(pos / step - Math.round(pos / step)) < 1e-6) continue;
          const half = Math.abs(pos / (step / 2) - Math.round(pos / (step / 2))) < 1e-6;
          const s = crisp(toScreen(pos));
          const tick = depth * (half ? 0.45 : 0.25);
          if (horizontal) {
            ctx.moveTo(s, depth);
            ctx.lineTo(s, depth - tick);
          } else {
            ctx.moveTo(depth, s);
            ctx.lineTo(depth - tick, s);
          }
        }
      }
      for (let n = Math.ceil(from / step); n * step <= to; n++) {
        const s = crisp(toScreen(n * step));
        if (horizontal) {
          ctx.moveTo(s, depth);
          ctx.lineTo(s, 0);
        } else {
          ctx.moveTo(depth, s);
          ctx.lineTo(0, s);
        }
      }
      ctx.strokeStyle = STAGE_COLORS.rulerLine;
      ctx.lineWidth = line;
      ctx.stroke();

      ctx.font = FONT;
      ctx.fillStyle = STAGE_COLORS.rulerText;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      for (let n = Math.ceil(from / step); n * step <= to; n++) {
        const s = toScreen(n * step);
        const label = String(Math.round(n * step));
        if (horizontal) {
          ctx.fillText(label, s + 3, 2);
        } else {
          ctx.save();
          ctx.translate(2, s - 3);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      }

      if (app.view.guides) {
        ctx.fillStyle = STAGE_COLORS.guide;
        for (const guide of doc.guides) {
          if (guide.axis !== axis) continue;
          const s = toScreen(guide.pos);
          if (s < -4 || s > length + 4) continue;
          ctx.beginPath();
          if (horizontal) {
            ctx.moveTo(s - 4, depth);
            ctx.lineTo(s + 4, depth);
            ctx.lineTo(s, depth - 5);
          } else {
            ctx.moveTo(depth, s - 4);
            ctx.lineTo(depth, s + 4);
            ctx.lineTo(depth - 5, s);
          }
          ctx.fill();
        }
      }

      if (pointer) {
        const s = crisp((horizontal ? pointer.x - own.left : pointer.y - own.top));
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(s, 0);
          ctx.lineTo(s, depth);
        } else {
          ctx.moveTo(0, s);
          ctx.lineTo(depth, s);
        }
        ctx.strokeStyle = STAGE_COLORS.accent;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.fillStyle = STAGE_COLORS.rulerLine;
    if (horizontal) ctx.fillRect(0, cssH - 1, cssW, 1);
    else ctx.fillRect(cssW - 1, 0, 1, cssH);
  }

  // The ticks follow the zoom, the pan, the stage size and the guides.
  $effect(() => {
    void app.viewTick;
    void app.zoom;
    void app.view.guides;
    const doc = app.doc;
    void doc?.width;
    void doc?.height;
    void doc?.guides;
    schedule();
  });

  onMount(() => {
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      cssW = box.width;
      cssH = box.height;
      dpr = Math.min(TUNING.stage.maxDpr, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      draw();
    });
    observer.observe(wrap);

    const onWindowMove = (event: PointerEvent): void => {
      const cell = stageCell();
      if (!cell) return;
      const box = cell.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      const next = inside || dragging ? { x: event.clientX, y: event.clientY } : null;
      if (next === null && pointer === null) return;
      pointer = next;
      schedule();
    };
    window.addEventListener('pointermove', onWindowMove, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('pointermove', onWindowMove);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (dragging) setRulerGuide(null);
    };
  });

  /** The guide under the pointer of a ruler drag: snapped to the stage edges and center (Ctrl turns it off). */
  function draftOf(event: PointerEvent) {
    const stage = app.stage;
    const cell = stageCell();
    if (!stage || !cell) return null;
    const box = cell.getBoundingClientRect();
    const sx = event.clientX - box.left;
    const sy = event.clientY - box.top;
    const point = stage.screenToDoc(sx, sy);
    const raw = guideAxis === 'x' ? point.x : point.y;
    const snapped = snapValueLive(raw, guideAxis, event.ctrlKey || event.metaKey, (target) => target.kind === 'stage-edge' || target.kind === 'stage-center');
    const pos = snapped === raw ? Math.round(raw) : cleanGuidePos(snapped);
    return { axis: guideAxis, pos, sx, sy, remove: !guideKept(guideAxis, pos, sx, sy) };
  }

  function onDown(event: PointerEvent): void {
    if (event.button !== 0 || !app.doc || !app.stage) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    dragging = true;
    if (!app.view.guides) app.setView({ guides: true });
    setRulerGuide(draftOf(event));
  }

  function onMove(event: PointerEvent): void {
    if (!dragging) return;
    setRulerGuide(draftOf(event));
  }

  function onUp(event: PointerEvent, cancelled: boolean): void {
    if (!dragging) return;
    dragging = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const draft = cancelled ? null : draftOf(event);
    setRulerGuide(null);
    clearSnapFeedback();
    const doc = app.doc;
    if (!doc || !draft || draft.remove) return;
    doc.setGuides([...doc.guides, { id: doc.nextGuideId(), axis: draft.axis, pos: draft.pos }], 'geometry.history.guideAdd');
    sfx.play('tick');
  }

  // ----- settings popover -----

  function toggleSettings(): void {
    if (settingsOpen) {
      settingsOpen = false;
      return;
    }
    const box = settingsButton?.getBoundingClientRect();
    if (box) popoverPos = { top: Math.round(box.bottom + 6), right: Math.round(window.innerWidth - box.right) };
    settingsOpen = true;
    sfx.play('tick');
  }

  $effect(() => {
    if (!settingsOpen) return;
    const onPress = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && (popover?.contains(target) || settingsButton?.contains(target))) return;
      settingsOpen = false;
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      settingsOpen = false;
      settingsButton?.focus();
    };
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('keydown', onKey, true);
    };
  });

  const grid = $derived<GridSpec | null>(app.doc?.grid ?? null);

  function setGrid(patch: Partial<GridSpec>): void {
    const doc = app.doc;
    if (!doc) return;
    doc.setGrid({ ...doc.grid, ...patch });
    if (!app.view.grid) app.setView({ grid: true });
    app.stage?.invalidateFx();
  }

  function gridNumber(event: Event, key: 'spacing' | 'cols' | 'rows'): void {
    const input = event.currentTarget as HTMLInputElement;
    const limits = TUNING.geometry.gridLimits[key];
    const value = Number(input.value.trim());
    if (!Number.isInteger(value) || value < limits.min || value > limits.max) {
      sfx.play('error');
      input.value = String(app.doc?.grid[key] ?? limits.min);
      return;
    }
    sfx.play('tick');
    setGrid({ [key]: value });
  }

  function onGridKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    (event.currentTarget as HTMLInputElement).blur();
  }
</script>

<div class="ruler" class:ruler-y={axis === 'y'} style:--ruler-size="{TUNING.stage.rulerPx}px" bind:this={wrap}>
  <canvas
    class="ruler-canvas"
    bind:this={canvas}
    aria-hidden="true"
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={(event) => onUp(event, false)}
    onpointercancel={(event) => onUp(event, true)}
    onpointerleave={() => {
      if (!dragging && pointer) schedule();
    }}
  ></canvas>
  {#if axis === 'x'}
    <button
      type="button"
      class="ruler-settings"
      bind:this={settingsButton}
      aria-label={t('geometry.ruler.settings')}
      aria-expanded={settingsOpen}
      aria-haspopup="dialog"
      use:tooltip={{ text: t('geometry.ruler.settings') }}
      onclick={toggleSettings}
    >
      <Settings2 size={13} strokeWidth={2.5} />
    </button>
  {/if}
</div>

{#if settingsOpen && axis === 'x'}
  <div class="ruler-popover" role="dialog" aria-label={t('geometry.ruler.settings')} bind:this={popover} style:top="{popoverPos.top}px" style:right="{popoverPos.right}px">
    <section class="pop-section">
      <h3 class="section-title">{t('geometry.ruler.guides')}</h3>
      <div class="pop-row">
        <button type="button" class="btn btn-small" onclick={() => runAction('guides.center', 'pointer')}>{t('geometry.ruler.center')}</button>
        <button type="button" class="btn btn-small" onclick={() => runAction('guides.thirds', 'pointer')}>{t('geometry.ruler.thirds')}</button>
        <button type="button" class="btn btn-small btn-quiet" disabled={!app.doc?.guides.length} onclick={() => runAction('guides.clear', 'pointer')}>
          {t('geometry.ruler.clear')}
        </button>
      </div>
      <p class="hint">{t('geometry.ruler.dragHint')}</p>
    </section>

    {#if grid}
      <section class="pop-section">
        <h3 class="section-title">{t('geometry.ruler.grid')}</h3>
        <ToggleSwitch id="ruler-grid-on" label={t('geometry.ruler.showGrid')} checked={app.view.grid} onchange={(checked) => app.setView({ grid: checked })} />
        <ToggleSwitch id="ruler-snap-on" label={t('geometry.ruler.snap')} checked={app.view.snap} onchange={(checked) => app.setView({ snap: checked })} />
        <div class="segmented" role="group" aria-label={t('geometry.ruler.gridMode')}>
          <button
            type="button"
            aria-pressed={grid.mode === 'spacing'}
            onclick={() => {
              sfx.play('tick');
              setGrid({ mode: 'spacing' });
            }}>{t('geometry.ruler.modeSpacing')}</button
          >
          <button
            type="button"
            aria-pressed={grid.mode === 'divisions'}
            onclick={() => {
              sfx.play('tick');
              setGrid({ mode: 'divisions' });
            }}>{t('geometry.ruler.modeDivisions')}</button
          >
        </div>
        {#if grid.mode === 'spacing'}
          <label class="field">
            <span class="field-label">{t('geometry.ruler.spacing')}</span>
            <input class="number-input" name="grid-spacing" inputmode="numeric" autocomplete="off" value={grid.spacing} onchange={(event) => gridNumber(event, 'spacing')} onkeydown={onGridKey} />
          </label>
        {:else}
          <div class="pop-pair">
            <label class="field">
              <span class="field-label">{t('geometry.ruler.cols')}</span>
              <input class="number-input" name="grid-cols" inputmode="numeric" autocomplete="off" value={grid.cols} onchange={(event) => gridNumber(event, 'cols')} onkeydown={onGridKey} />
            </label>
            <label class="field">
              <span class="field-label">{t('geometry.ruler.rows')}</span>
              <input class="number-input" name="grid-rows" inputmode="numeric" autocomplete="off" value={grid.rows} onchange={(event) => gridNumber(event, 'rows')} onkeydown={onGridKey} />
            </label>
          </div>
        {/if}
      </section>
    {/if}
  </div>
{/if}

<style>
  @layer components {
    .ruler {
      position: relative;
      inline-size: 100%;
      block-size: var(--ruler-size);
      background: var(--stage-ruler);
      contain: strict;
    }

    .ruler-y {
      inline-size: var(--ruler-size);
      block-size: 100%;
    }

    .ruler-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      cursor: row-resize;

      .ruler-y & {
        cursor: col-resize;
      }
    }

    .ruler-settings {
      position: absolute;
      top: 1px;
      right: 2px;
      display: grid;
      place-items: center;
      width: calc(var(--ruler-size) - 3px);
      height: calc(var(--ruler-size) - 3px);
      color: var(--text-muted);
      background: var(--surface-2);
      border: 1px solid var(--line);
      border-radius: 5px;
      transition:
        color var(--dur-hover) var(--ease-sym),
        background-color var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover {
        color: var(--text);
        background: var(--surface-3);
      }

      &:active {
        transform: translateY(1px) scale(0.94);
        transition-duration: 60ms;
      }

      &[aria-expanded='true'] {
        color: var(--on-primary);
        background: var(--primary);
        border-color: var(--primary-edge);
      }
    }

    .ruler-popover {
      position: fixed;
      z-index: 50;
      display: grid;
      gap: var(--space-4);
      width: 280px;
      padding: var(--space-4);
      background: var(--surface-1);
      border: 2px solid var(--line-strong);
      border-radius: var(--radius-l);
      box-shadow: 0 6px 0 var(--depth);
      transform-origin: top right;
      animation: ruler-pop var(--dur-pop) var(--ease-out);
    }

    .pop-section {
      display: grid;
      gap: var(--space-2);
    }

    .pop-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }

    .pop-pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-2);
    }

    @keyframes ruler-pop {
      from {
        opacity: 0;
        transform: translateY(-6px) scale(0.96);
      }
    }
  }
</style>
