<script lang="ts">
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowDownLeft from '@lucide/svelte/icons/arrow-down-left';
  import ArrowDownRight from '@lucide/svelte/icons/arrow-down-right';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowUpLeft from '@lucide/svelte/icons/arrow-up-left';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import ImageIcon from '@lucide/svelte/icons/image';
  import { untrack, type Component } from 'svelte';
  import { applyStageRect, stageFillColor, stageSizeProblem, type StageFill } from '../../app/actions/geometry.ts';
  import { locale, parseDecimal, t, type TextKey } from '../../app/i18n/index.ts';
  import { lastCanvasFill, saveCanvasFill } from '../../app/last-used.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app } from '../../app/state.svelte.ts';
  import { flashStageOutline } from '../../app/tools/crop.ts';
  import Dialog from '../base/Dialog.svelte';
  import ToggleSwitch from '../base/ToggleSwitch.svelte';

  type Unit = 'px' | 'pct';
  type Icon = Component<{ size?: number | string; strokeWidth?: number | string }>;

  const FILLS: readonly { id: StageFill; label: TextKey }[] = [
    { id: 'transparent', label: 'geometry.fill.transparent' },
    { id: 'white', label: 'geometry.fill.white' },
    { id: 'black', label: 'geometry.fill.black' },
    { id: 'fg', label: 'geometry.fill.fg' },
    { id: 'bg', label: 'geometry.fill.bg' },
  ];
  /** The arrow of a cell next to the anchor, by its direction (dx, dy). */
  const ARROWS: Record<string, Icon> = {
    '-1,-1': ArrowUpLeft,
    '0,-1': ArrowUp,
    '1,-1': ArrowUpRight,
    '-1,0': ArrowLeft,
    '1,0': ArrowRight,
    '-1,1': ArrowDownLeft,
    '0,1': ArrowDown,
    '1,1': ArrowDownRight,
  };
  const ANCHOR_NAMES: readonly TextKey[] = [
    'geometry.anchor.nw',
    'geometry.anchor.n',
    'geometry.anchor.ne',
    'geometry.anchor.w',
    'geometry.anchor.c',
    'geometry.anchor.e',
    'geometry.anchor.sw',
    'geometry.anchor.s',
    'geometry.anchor.se',
  ];
  const PREVIEW = { w: 220, h: 120 };

  const amount = new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false });

  const open = $derived(app.dialog === 'canvas-size');
  let unit = $state<Unit>('px');
  let relative = $state(false);
  let widthText = $state('');
  let heightText = $state('');
  let anchor = $state({ x: 1, y: 1 });
  let fill = $state<StageFill>(lastCanvasFill());
  let cells = $state<HTMLButtonElement[]>([]);

  const oldW = $derived(app.doc?.width ?? 1);
  const oldH = $derived(app.doc?.height ?? 1);

  // Each opening starts from the current size.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      unit = 'px';
      relative = false;
      fill = lastCanvasFill();
      widthText = String(oldW);
      heightText = String(oldH);
    });
  });

  /** The new side in px from the typed value, or null when it is not a number. */
  function sideOf(text: string, old: number, inUnit: Unit, isRelative: boolean): number | null {
    const value = parseDecimal(text);
    if (value === null) return null;
    if (inUnit === 'px') return Math.round(isRelative ? old + value : value);
    return Math.round(isRelative ? old * (1 + value / 100) : (old * value) / 100);
  }

  function textOf(side: number, old: number, inUnit: Unit, isRelative: boolean): string {
    if (inUnit === 'px') return String(isRelative ? side - old : side);
    return amount.format(isRelative ? (side / old - 1) * 100 : (side / old) * 100);
  }

  const width = $derived(sideOf(widthText, oldW, unit, relative));
  const height = $derived(sideOf(heightText, oldH, unit, relative));
  const problem = $derived(width === null || height === null ? t('geometry.invalid.number') : stageSizeProblem(width, height));
  const rect = $derived(
    width !== null && height !== null ? { x: Math.round(((oldW - width) * anchor.x) / 2), y: Math.round(((oldH - height) * anchor.y) / 2), w: width, h: height } : null,
  );

  /** The new stage and the old one inside it, scaled to the preview box. */
  const preview = $derived.by(() => {
    if (!rect || problem) return null;
    const ox = -rect.x;
    const oy = -rect.y;
    const left = Math.min(0, ox);
    const top = Math.min(0, oy);
    const right = Math.max(rect.w, ox + oldW);
    const bottom = Math.max(rect.h, oy + oldH);
    const scale = Math.min(PREVIEW.w / (right - left), PREVIEW.h / (bottom - top));
    const box = (x: number, y: number, w: number, h: number) => ({ x: (x - left) * scale, y: (y - top) * scale, w: Math.max(2, w * scale), h: Math.max(2, h * scale) });
    return { frame: box(left, top, right - left, bottom - top), next: box(0, 0, rect.w, rect.h), old: box(ox, oy, oldW, oldH) };
  });

  function cancel(): void {
    sfx.play('cancel');
    close();
  }

  function close(): void {
    app.openDialog('none');
  }

  /** Changes the unit or the relative switch and keeps the size that the fields mean now. */
  function convert(nextUnit: Unit, nextRelative: boolean): void {
    if (width !== null && height !== null) {
      widthText = textOf(width, oldW, nextUnit, nextRelative);
      heightText = textOf(height, oldH, nextUnit, nextRelative);
    } else {
      widthText = textOf(oldW, oldW, nextUnit, nextRelative);
      heightText = textOf(oldH, oldH, nextUnit, nextRelative);
    }
    unit = nextUnit;
    relative = nextRelative;
  }

  function pickUnit(next: Unit): void {
    if (next === unit) return;
    sfx.play('tick');
    convert(next, relative);
  }

  function growth(side: number | null, old: number): number {
    if (side === null || side === old) return 0;
    return side > old ? 1 : -1;
  }

  /** The arrow of a cell: from the anchor outward when the stage grows, inward when it shrinks. */
  function arrowOf(cx: number, cy: number): Icon | null {
    const dx = cx - anchor.x;
    const dy = cy - anchor.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return null;
    const gx = dx * growth(width, oldW);
    const gy = dy * growth(height, oldH);
    if (gx === 0 && gy === 0) return null;
    return ARROWS[`${gx},${gy}`] ?? null;
  }

  function pickAnchor(x: number, y: number, focus = false): void {
    if (anchor.x === x && anchor.y === y) return;
    anchor = { x, y };
    sfx.play('tick');
    if (focus) cells[y * 3 + x]?.focus();
  }

  function onAnchorKey(event: KeyboardEvent): void {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    pickAnchor(Math.min(2, Math.max(0, anchor.x + move[0])), Math.min(2, Math.max(0, anchor.y + move[1])), true);
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const doc = app.doc;
    if (!doc || !rect || problem) {
      sfx.play('error');
      return;
    }
    const color = stageFillColor(fill);
    saveCanvasFill(fill);
    close();
    try {
      const done = await applyStageRect(doc, rect, color, 'geometry.history.canvasSize');
      if (done) {
        sfx.play('crop');
        flashStageOutline();
      } else sfx.play('tick');
    } catch (error) {
      app.fail(error);
    }
  }

  function swatch(id: StageFill): string | null {
    const color = stageFillColor(id);
    return color ? `rgb(${color.r} ${color.g} ${color.b})` : null;
  }
</script>

<Dialog {open} labelledby="canvas-size-title" onclose={close}>
  <form class="dialog-body" onsubmit={submit}>
    <h2 id="canvas-size-title" class="dialog-title">{t('geometry.canvas.title')}</h2>
    <p class="hint">{t('geometry.current', { w: oldW, h: oldH })}</p>

    <div class="row">
      <div class="segmented unit" role="group" aria-label={t('geometry.unit')}>
        <button type="button" aria-pressed={unit === 'px'} onclick={() => pickUnit('px')}>px</button>
        <button type="button" aria-pressed={unit === 'pct'} onclick={() => pickUnit('pct')}>%</button>
      </div>
      <ToggleSwitch id="canvas-relative" label={t('geometry.canvas.relative')} hint={t('geometry.canvas.relativeHint')} checked={relative} onchange={(checked) => convert(unit, checked)} />
    </div>

    <div class="sides">
      <label class="field">
        <span class="field-label">{t('geometry.width')} ({unit === 'px' ? 'px' : '%'})</span>
        <input class="number-input" name="canvas-width" data-autofocus inputmode="decimal" autocomplete="off" bind:value={widthText} aria-invalid={width === null || problem !== null} />
      </label>
      <label class="field">
        <span class="field-label">{t('geometry.height')} ({unit === 'px' ? 'px' : '%'})</span>
        <input class="number-input" name="canvas-height" inputmode="decimal" autocomplete="off" bind:value={heightText} aria-invalid={height === null || problem !== null} />
      </label>
    </div>

    {#if problem}
      <p class="hint invalid" role="alert">{problem}</p>
    {:else if rect}
      <p class="hint">{t('geometry.canvas.result', { w: rect.w, h: rect.h })}</p>
    {/if}

    <div class="place">
      <fieldset class="group">
        <legend class="field-label">{t('geometry.anchor.label')}</legend>
        <div class="anchors" role="radiogroup" aria-label={t('geometry.anchor.label')}>
          {#each ANCHOR_NAMES as name, index (index)}
            {@const cx = index % 3}
            {@const cy = Math.floor(index / 3)}
            {@const selected = anchor.x === cx && anchor.y === cy}
            {@const Arrow = arrowOf(cx, cy)}
            <button
              type="button"
              class="anchor"
              role="radio"
              aria-checked={selected}
              aria-label={t(name)}
              title={t(name)}
              tabindex={selected ? 0 : -1}
              bind:this={cells[index]}
              onclick={() => pickAnchor(cx, cy)}
              onkeydown={onAnchorKey}
            >
              {#if selected}
                <ImageIcon size={16} strokeWidth={2.5} />
              {:else if Arrow}
                <Arrow size={15} strokeWidth={2.5} />
              {/if}
            </button>
          {/each}
        </div>
      </fieldset>

      <div class="preview-box" style:width="{PREVIEW.w}px" style:height="{PREVIEW.h}px" aria-hidden="true">
        {#if preview}
          <div class="preview-frame" style:width="{preview.frame.w}px" style:height="{preview.frame.h}px">
            <div
              class="preview-new"
              class:swatch-transparent={fill === 'transparent'}
              style:background-color={swatch(fill)}
              style:translate="{preview.next.x}px {preview.next.y}px"
              style:width="{preview.next.w}px"
              style:height="{preview.next.h}px"
            ></div>
            <div class="preview-old" style:translate="{preview.old.x}px {preview.old.y}px" style:width="{preview.old.w}px" style:height="{preview.old.h}px"></div>
          </div>
        {/if}
      </div>
    </div>

    <fieldset class="group">
      <legend class="field-label">{t('geometry.fill.newArea')}</legend>
      <div class="fills">
        {#each FILLS as entry (entry.id)}
          <button
            type="button"
            class="fill"
            aria-pressed={fill === entry.id}
            onclick={() => {
              sfx.play('tick');
              fill = entry.id;
            }}
          >
            <span class="swatch" class:swatch-transparent={entry.id === 'transparent'} style:background-color={swatch(entry.id)} aria-hidden="true"></span>
            {t(entry.label)}
          </button>
        {/each}
      </div>
    </fieldset>

    <div class="dialog-actions">
      <button type="button" class="btn btn-quiet" onclick={cancel}>{t('common.cancel')}</button>
      <button type="submit" class="btn btn-primary" disabled={problem !== null}>{t('geometry.ok')}</button>
    </div>
  </form>
</Dialog>

<style>
  @layer components {
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-4);
    }

    .unit {
      flex: none;
      width: 7rem;
    }

    .sides {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-3);
    }

    .invalid {
      color: var(--danger-text);
    }

    .place {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      justify-content: space-between;
      gap: var(--space-4);
    }

    .group {
      display: grid;
      gap: var(--space-2);
      min-width: 0;
      border: 0;
    }

    .anchors {
      display: grid;
      grid-template-columns: repeat(3, 34px);
      grid-template-rows: repeat(3, 34px);
      gap: 4px;
      padding: 4px;
      background: var(--surface-sunken);
      border: 2px solid var(--line);
      border-radius: var(--radius-m);
    }

    .anchor {
      display: grid;
      place-items: center;
      color: var(--text-muted);
      background: var(--surface-2);
      border: 1px solid var(--line);
      border-radius: 6px;
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        color var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover:not([aria-checked='true']) {
        color: var(--text);
        background: var(--surface-3);
      }

      &:active {
        transform: scale(0.92);
        transition-duration: 60ms;
      }

      &[aria-checked='true'] {
        color: var(--on-primary);
        background: var(--primary);
        border-color: var(--primary-edge);
      }
    }

    .preview-box {
      display: grid;
      place-items: center;
      flex: none;
      background: var(--surface-sunken);
      border: 2px solid var(--line);
      border-radius: var(--radius-m);
      padding: 6px;
      box-sizing: content-box;
    }

    .preview-frame {
      position: relative;
    }

    .preview-new,
    .preview-old {
      position: absolute;
      top: 0;
      left: 0;
      transition: translate var(--dur-pop) var(--ease-out);
    }

    .preview-new {
      border: 1px solid var(--line-strong);
      box-shadow: 0 3px 0 var(--depth);
    }

    .preview-old {
      background: color-mix(in oklch, var(--primary), transparent 72%);
      border: 2px solid var(--primary);
      border-radius: 2px;
    }

    .fills {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }

    .fill {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: 32px;
      padding: 0 var(--space-3);
      font: 800 0.8125rem/1 var(--font-display);
      color: var(--text-muted);
      background: var(--surface-2);
      border: 2px solid var(--line);
      border-radius: var(--radius-s);
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        border-color var(--dur-hover) var(--ease-sym),
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
        color: var(--text);
        background: var(--primary-fill);
        border-color: var(--primary);
      }
    }

    .swatch {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 1px solid var(--line-strong);
      border-radius: 4px;
    }

    .swatch-transparent {
      background: repeating-conic-gradient(var(--checker-a) 0 25%, var(--checker-b) 0 50%) 0 0 / 8px 8px;
    }
  }
</style>
