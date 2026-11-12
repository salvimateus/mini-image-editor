<script lang="ts">
  import Pipette from '@lucide/svelte/icons/pipette';
  import Wand from '@lucide/svelte/icons/wand-sparkles';
  import { onDestroy } from 'svelte';
  import { autoLevels, cleanLevels, gammaFromHandle, gammaHandle, isLevelsIdentity, LEVELS_IDENTITY } from '../../core/adjust/index.ts';
  import { PARAMS } from '../../core/params/index.ts';
  import type { AdjustOp, Histogram, LevelsParams } from '../../core/types.ts';
  import { locale, parseDecimal, t, type TextKey } from '../../app/i18n/index.ts';
  import KeyText from '../base/KeyText.svelte';
  import * as sfx from '../../app/sfx.ts';
  import { app } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import type { StagePointer } from '../stage-renderer.ts';
  import AdjustPanel from './AdjustPanel.svelte';
  import { theme } from '../../app/theme.svelte.ts';

  type Channel = LevelsParams['channel'];
  type Handle = 'inBlack' | 'gamma' | 'inWhite' | 'outBlack' | 'outWhite';
  type Picker = 'black' | 'gray' | 'white';

  const tuning = TUNING.adjust.levels;
  const span = PARAMS.adjust.levels.minInputSpan;
  const CHANNELS: readonly { id: Channel; short: string; name: TextKey }[] = [
    { id: 'rgb', short: 'RGB', name: 'adjust.levels.channel.rgb' },
    { id: 'r', short: 'R', name: 'adjust.levels.channel.r' },
    { id: 'g', short: 'G', name: 'adjust.levels.channel.g' },
    { id: 'b', short: 'B', name: 'adjust.levels.channel.b' },
  ];
  const PICKERS: readonly { id: Picker; label: TextKey }[] = [
    { id: 'black', label: 'adjust.levels.pickBlack' },
    { id: 'gray', label: 'adjust.levels.pickGray' },
    { id: 'white', label: 'adjust.levels.pickWhite' },
  ];
  const HANDLE_LABEL: Record<Handle, TextKey> = {
    inBlack: 'adjust.levels.black',
    gamma: 'adjust.levels.gamma',
    inWhite: 'adjust.levels.white',
    outBlack: 'adjust.levels.outBlack',
    outWhite: 'adjust.levels.outWhite',
  };

  const gammaFormat = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

  let params = $state<LevelsParams>({ ...LEVELS_IDENTITY });
  let histogram = $state.raw<Histogram | null>(null);
  let picking = $state<Picker | null>(null);
  let pickHandler: ((p: StagePointer) => void) | null = null;
  let drafts = $state<Partial<Record<Handle, string>>>({});
  let dragging = $state<Handle | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let inputTrack = $state<HTMLElement | null>(null);
  let outputTrack = $state<HTMLElement | null>(null);

  const identity = $derived(isLevelsIdentity(params));
  const op = $derived<AdjustOp | null>(identity ? null : { kind: 'levels', params: { ...params } });
  const gammaAt = $derived(gammaHandle(params));
  const bins = $derived(histogram ? (params.channel === 'rgb' ? histogram.luma : histogram[params.channel]) : null);
  const emptyHistogram = $derived(!!bins && bins.every((value) => value === 0));

  // A pick that another part of the app replaced, or that the stage used, is over.
  $effect(() => {
    if (picking && app.stagePick !== pickHandler) {
      picking = null;
      pickHandler = null;
    }
  });

  $effect(() => {
    const target = canvas;
    const values = bins;
    void params.channel;
    void theme.current;
    if (!target) return;
    drawHistogram(target, values);
  });

  onDestroy(() => stopPicking());

  function drawHistogram(target: HTMLCanvasElement, values: Uint32Array | null): void {
    const ctx = target.getContext('2d');
    if (!ctx) return;
    const { width, height } = target;
    ctx.clearRect(0, 0, width, height);
    if (!values) return;
    let sum = 0;
    let used = 0;
    let max = 0;
    for (const value of values) {
      if (value === 0) continue;
      sum += value;
      used += 1;
      if (value > max) max = value;
    }
    if (used === 0) return;
    const top = Math.min(max, (sum / used) * tuning.histogramCap);
    ctx.fillStyle = getComputedStyle(target).color;
    for (let x = 0; x < 256; x++) {
      const bar = Math.min(1, values[x] / top) * height;
      if (bar > 0) ctx.fillRect(x, height - bar, 1, bar);
    }
  }

  function setParams(next: LevelsParams): void {
    params = cleanLevels(next);
  }

  function setHandle(which: Handle, value: number): void {
    const v = Math.min(255, Math.max(0, value));
    switch (which) {
      case 'inBlack':
        setParams({ ...params, inBlack: Math.min(Math.round(v), params.inWhite - span) });
        break;
      case 'inWhite':
        setParams({ ...params, inWhite: Math.max(Math.round(v), params.inBlack + span) });
        break;
      case 'gamma':
        setParams({ ...params, gamma: Math.round(gammaFromHandle(params, v) * 100) / 100 });
        break;
      case 'outBlack':
        setParams({ ...params, outBlack: Math.round(v) });
        break;
      case 'outWhite':
        setParams({ ...params, outWhite: Math.round(v) });
        break;
    }
  }

  function handleValue(which: Handle): number {
    return which === 'gamma' ? gammaAt : params[which];
  }

  function shown(which: Handle): string {
    const draft = drafts[which];
    if (draft !== undefined) return draft;
    return which === 'gamma' ? gammaFormat.format(params.gamma) : String(params[which]);
  }

  function commitField(which: Handle): void {
    const draft = drafts[which];
    if (draft === undefined) return;
    dropDraft(which);
    const value = parseDecimal(draft);
    if (value === null) return;
    sfx.play('tick');
    if (which === 'gamma') setParams({ ...params, gamma: value });
    else if (which === 'inBlack') setParams({ ...params, inBlack: Math.min(value, params.inWhite - span) });
    else if (which === 'inWhite') setParams({ ...params, inWhite: Math.max(value, params.inBlack + span) });
    else setParams({ ...params, [which]: value });
  }

  function onFieldKey(event: KeyboardEvent, which: Handle): void {
    // Enter commits the number and goes on, so the panel applies.
    if (event.key === 'Enter') {
      commitField(which);
    } else if (event.key === 'Escape' && drafts[which] !== undefined) {
      event.preventDefault();
      dropDraft(which);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      nudge(which, event.key === 'ArrowUp' ? 1 : -1, event.shiftKey);
    }
  }

  function dropDraft(which: Handle): void {
    if (drafts[which] === undefined) return;
    const next = { ...drafts };
    delete next[which];
    drafts = next;
  }

  function nudge(which: Handle, direction: 1 | -1, big: boolean): void {
    dropDraft(which);
    sfx.play('tick');
    if (which === 'gamma') {
      // The gray handle moves right when gamma goes down.
      setParams({ ...params, gamma: Math.round((params.gamma - direction * tuning.gammaKeyStep * (big ? 10 : 1)) * 100) / 100 });
      return;
    }
    setHandle(which, params[which] + direction * tuning.keyStep * (big ? 10 : 1));
  }

  function onHandleKey(event: KeyboardEvent, which: Handle): void {
    const keys: Record<string, 1 | -1> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    const direction = keys[event.key];
    if (!direction) return;
    event.preventDefault();
    nudge(which, direction, event.shiftKey);
  }

  function valueAt(event: PointerEvent, track: HTMLElement | null): number | null {
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return ((event.clientX - rect.left) / rect.width) * 255;
  }

  function startDrag(event: PointerEvent, which: Handle, disabled: boolean): void {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    dragging = which;
  }

  function moveDrag(event: PointerEvent, which: Handle): void {
    if (dragging !== which) return;
    const value = valueAt(event, which === 'outBlack' || which === 'outWhite' ? outputTrack : inputTrack);
    if (value === null) return;
    sfx.play('tick');
    setHandle(which, value);
  }

  function endDrag(which: Handle): void {
    if (dragging === which) dragging = null;
  }

  function auto(): void {
    if (!histogram) return;
    sfx.play('tick');
    setParams(autoLevels(histogram));
  }

  function stopPicking(): void {
    if (pickHandler && app.stagePick === pickHandler) app.requestStagePick(null);
    pickHandler = null;
    picking = null;
  }

  function togglePick(which: Picker): void {
    sfx.play('tick');
    if (picking === which) {
      stopPicking();
      return;
    }
    const handler = (p: StagePointer) => {
      pickHandler = null;
      picking = null;
      pick(which, p);
    };
    pickHandler = handler;
    picking = which;
    app.requestStagePick(handler);
  }

  function pick(which: Picker, p: StagePointer): void {
    const doc = app.doc;
    if (!doc) return;
    const color = doc.sample(Math.floor(p.ix), Math.floor(p.iy));
    if (color.a === 0) {
      app.refuse(t('adjust.levels.pickTransparent'));
      return;
    }
    const { luma } = PARAMS.adjust;
    const value = params.channel === 'rgb' ? luma.r * color.r + luma.g * color.g + luma.b * color.b : color[params.channel];
    sfx.play('pick');
    if (which === 'black') setParams({ ...params, inBlack: Math.min(Math.round(value), params.inWhite - span) });
    else if (which === 'white') setParams({ ...params, inWhite: Math.max(Math.round(value), params.inBlack + span) });
    else setParams({ ...params, gamma: Math.round(gammaFromHandle(params, value) * 100) / 100 });
  }

  // Esc ends a pick before the panel sees it as Cancel.
  function onKeyCapture(event: KeyboardEvent): void {
    if (event.key === 'Escape' && picking) {
      event.preventDefault();
      event.stopPropagation();
      sfx.play('tick');
      stopPicking();
    }
  }

  function reset(): void {
    stopPicking();
    drafts = {};
    params = { ...LEVELS_IDENTITY, channel: params.channel };
  }

  function setChannel(channel: Channel): void {
    if (channel === params.channel) return;
    sfx.play('tick');
    params = { ...params, channel };
  }

  function percent(value: number): string {
    return `${(Math.min(255, Math.max(0, value)) / 255) * 100}%`;
  }
</script>

<svelte:window onkeydowncapture={onKeyCapture} />

{#snippet field(which: Handle, disabled: boolean)}
  <label class="level-field">
    <span class="visually-hidden">{t(HANDLE_LABEL[which])}</span>
    <input
      id="adjust-levels-{which}"
      name="adjust-levels-{which}"
      class="number-input level-number"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      title={t(HANDLE_LABEL[which])}
      {disabled}
      value={shown(which)}
      oninput={(event) => (drafts = { ...drafts, [which]: (event.currentTarget as HTMLInputElement).value })}
      onkeydown={(event) => onFieldKey(event, which)}
      onblur={() => commitField(which)}
    />
  </label>
{/snippet}

{#snippet handle(which: Handle, disabled: boolean, kind: string)}
  <span
    class="handle {kind}"
    class:is-dragging={dragging === which}
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={t(HANDLE_LABEL[which])}
    aria-valuemin={which === 'gamma' ? PARAMS.adjust.levels.gammaMin : 0}
    aria-valuemax={which === 'gamma' ? PARAMS.adjust.levels.gammaMax : 255}
    aria-valuenow={which === 'gamma' ? params.gamma : params[which]}
    aria-disabled={disabled}
    style:left={percent(handleValue(which))}
    onpointerdown={(event) => startDrag(event, which, disabled)}
    onpointermove={(event) => moveDrag(event, which)}
    onpointerup={() => endDrag(which)}
    onpointercancel={() => endDrag(which)}
    onlostpointercapture={() => endDrag(which)}
    onkeydown={(event) => !disabled && onHandleKey(event, which)}
  ></span>
{/snippet}

<AdjustPanel
  titleId="panel-levels-title"
  title={t('action.adjust.levels')}
  label="adjust.history.levels"
  {op}
  onbegin={(value) => (histogram = value)}
  canReset={!identity}
  onreset={reset}
>
  {#snippet children({ disabled })}
    <div class="segmented" role="group" aria-label={t('adjust.levels.channel')}>
      {#each CHANNELS as channel (channel.id)}
        <button type="button" aria-pressed={params.channel === channel.id} title={t(channel.name)} aria-label={t(channel.name)} {disabled} onclick={() => setChannel(channel.id)}>
          {channel.short}
        </button>
      {/each}
    </div>

    <fieldset class="group" {disabled}>
      <legend class="field-label">{t('adjust.levels.input')}</legend>
      <div class="histogram channel-{params.channel}" role="img" aria-label={t('adjust.levels.histogram')}>
        <canvas bind:this={canvas} class="histogram-canvas" width="256" height={tuning.histogramHeight} aria-hidden="true"></canvas>
        {#if emptyHistogram}<p class="histogram-empty">{t('adjust.levels.emptyHistogram')}</p>{/if}
      </div>
      <div class="track" bind:this={inputTrack}>
        {@render handle('inBlack', disabled, 'is-black')}
        {@render handle('gamma', disabled, 'is-gray')}
        {@render handle('inWhite', disabled, 'is-white')}
      </div>
      <div class="fields is-three">
        {@render field('inBlack', disabled)}
        {@render field('gamma', disabled)}
        {@render field('inWhite', disabled)}
      </div>
    </fieldset>

    <fieldset class="group" {disabled}>
      <legend class="field-label">{t('adjust.levels.output')}</legend>
      <div class="ramp channel-{params.channel}" aria-hidden="true"></div>
      <div class="track is-output" bind:this={outputTrack}>
        {@render handle('outBlack', disabled, 'is-black')}
        {@render handle('outWhite', disabled, 'is-white')}
      </div>
      <div class="fields is-two">
        {@render field('outBlack', disabled)}
        {@render field('outWhite', disabled)}
      </div>
    </fieldset>

    <div class="tools">
      <button type="button" class="btn btn-small" title={t('adjust.levels.autoHint')} disabled={disabled || !histogram} onclick={auto}>
        <Wand size={16} />
        {t('adjust.levels.auto')}
      </button>
      <div class="pickers" role="group" aria-label={t('adjust.levels.pickers')}>
        {#each PICKERS as picker (picker.id)}
          <button
            type="button"
            class="icon-btn picker is-{picker.id}"
            aria-pressed={picking === picker.id}
            aria-label={t(picker.label)}
            title={t(picker.label)}
            {disabled}
            onclick={() => togglePick(picker.id)}
          >
            <Pipette size={18} />
          </button>
        {/each}
      </div>
    </div>
    {#if picking}<p class="hint picking" role="status"><KeyText text={t('adjust.levels.picking')} /></p>{/if}
  {/snippet}
</AdjustPanel>

<style>
  @layer components {
    .group {
      display: grid;
      gap: var(--space-2);
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }

    .histogram {
      position: relative;
      padding: 4px 4px 0;
      color: var(--text-muted);
      background: var(--surface-sunken);
      border: 2px solid var(--line);
      border-bottom: 0;
      border-radius: var(--radius-s) var(--radius-s) 0 0;

      &.channel-r {
        color: var(--channel-red);
      }

      &.channel-g {
        color: var(--channel-green);
      }

      &.channel-b {
        color: var(--channel-blue);
      }
    }

    .histogram-canvas {
      display: block;
      width: 100%;
      height: 72px;
      color: inherit;
    }

    .histogram-empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: var(--space-2);
      color: var(--text-faint);
      font-size: 0.75rem;
      font-weight: 700;
      text-align: center;
    }

    .ramp {
      height: 14px;
      background: linear-gradient(to right, black, white);
      border: 2px solid var(--line);
      border-bottom: 0;
      border-radius: var(--radius-s) var(--radius-s) 0 0;

      &.channel-r {
        background: linear-gradient(to right, black, rgb(255 0 0));
      }

      &.channel-g {
        background: linear-gradient(to right, black, rgb(0 255 0));
      }

      &.channel-b {
        background: linear-gradient(to right, black, rgb(0 0 255));
      }
    }

    .track {
      position: relative;
      height: 18px;
      /* The handles line up with the inner edges of the histogram and of the ramp. */
      margin: -8px 6px 0;
      touch-action: none;

      &.is-output {
        margin-inline: 2px;
      }
    }

    .handle {
      position: absolute;
      top: 0;
      width: 18px;
      height: 18px;
      margin-left: -9px;
      cursor: ew-resize;
      clip-path: polygon(50% 0, 100% 100%, 0 100%);
      background: var(--line-strong);
      transition: transform var(--dur-hover) var(--ease-spring);

      &::after {
        content: '';
        position: absolute;
        inset: 3px 3px 1px;
        clip-path: polygon(50% 0, 100% 100%, 0 100%);
        background: var(--handle);
      }

      &.is-black {
        --handle: black;
      }

      &.is-gray {
        --handle: oklch(0.6 0 0);
      }

      &.is-white {
        --handle: white;
      }

      &:hover,
      &.is-dragging {
        transform: scale(1.2);
        background: var(--primary);
      }

      &:focus-visible {
        outline: none;
        background: var(--focus);
        transform: scale(1.2);
      }

      &[aria-disabled='true'] {
        cursor: not-allowed;
        opacity: 0.5;
      }
    }

    .fields {
      display: grid;
      gap: var(--space-2);

      &.is-three {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      &.is-two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    .level-field {
      display: block;
      min-width: 0;
    }

    .level-number {
      min-height: 30px;
      padding: 0 6px;
      font-size: 0.8125rem;
      font-weight: 700;
      text-align: center;
    }

    .tools {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }

    .pickers {
      display: flex;
      gap: 2px;
    }

    .picker {
      width: 36px;
      height: 36px;

      &.is-black {
        --tip: black;
      }

      &.is-gray {
        --tip: oklch(0.6 0 0);
      }

      &.is-white {
        --tip: white;
      }

      & :global(svg) {
        fill: var(--tip);
      }
    }

    .picking {
      color: var(--teal);
      font-weight: 700;
    }

    @media (prefers-reduced-motion: reduce) {
      .handle {
        transition: none;

        &:hover,
        &.is-dragging,
        &:focus-visible {
          transform: none;
        }
      }
    }
  }
</style>
