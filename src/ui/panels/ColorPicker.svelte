<script lang="ts">
  import { untrack } from 'svelte';
  import { fromHex, hsvToRgb, rgbToHsv, toHex } from '../../core/color.ts';
  import type { Rgba } from '../../core/types.ts';
  import { t } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';

  interface Props {
    color: Rgba;
    /** Each move of a drag. */
    oninput?: (color: Rgba) => void;
    /** The end of a drag, an arrow key or a typed value. */
    onchange: (color: Rgba) => void;
  }

  let { color, oninput, onchange }: Props = $props();

  const uid = $props.id();
  type Channel = 'r' | 'g' | 'b';
  const CHANNELS: readonly { key: Channel; short: string; label: 'paint.picker.red' | 'paint.picker.green' | 'paint.picker.blue' }[] = [
    { key: 'r', short: 'R', label: 'paint.picker.red' },
    { key: 'g', short: 'G', label: 'paint.picker.green' },
    { key: 'b', short: 'B', label: 'paint.picker.blue' },
  ];

  // The picker keeps its own hue and saturation, so a gray or black color does not reset them.
  let hue = $state(0);
  let sat = $state(0);
  let val = $state(0);
  let hexDraft = $state<string | null>(null);
  let channelDraft = $state<Partial<Record<Channel, string>>>({});
  let drag: { kind: 'sv' | 'hue'; box: DOMRect } | null = null;

  const current = $derived(hsvToRgb(hue, sat, val));
  const hex = $derived(toHex(current));
  const hueCss = $derived(`hsl(${Math.round(hue)} 100% 50%)`);
  const hexInvalid = $derived(hexDraft !== null && hexDraft.trim() !== '' && fromHex(hexDraft) === null);

  function sameRgb(a: Rgba, b: Rgba): boolean {
    return a.r === b.r && a.g === b.g && a.b === b.b;
  }

  /** Takes a color from outside; the hue and saturation stay when the color has none. */
  function adopt(next: Rgba): void {
    const hsv = rgbToHsv(next);
    if (hsv.v > 0 && hsv.s > 0) hue = hsv.h;
    if (hsv.v > 0) sat = hsv.s;
    val = hsv.v;
  }

  // Only a new color from outside moves the picker; its own drag must not rerun this.
  $effect.pre(() => {
    const next = color;
    untrack(() => {
      if (!sameRgb(next, hsvToRgb(hue, sat, val))) adopt(next);
    });
  });

  function emit(final: boolean): void {
    const next = { ...current, a: 255 };
    if (final) onchange(next);
    else oninput?.(next);
  }

  function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  function applyPointer(event: PointerEvent): void {
    if (!drag) return;
    const { box } = drag;
    const x = clamp01((event.clientX - box.left) / Math.max(1, box.width));
    const y = clamp01((event.clientY - box.top) / Math.max(1, box.height));
    if (drag.kind === 'sv') {
      sat = x;
      val = 1 - y;
    } else {
      hue = (1 - y) * 360;
    }
  }

  function onPointerDown(event: PointerEvent, kind: 'sv' | 'hue'): void {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.focus({ preventScroll: true });
    target.setPointerCapture(event.pointerId);
    drag = { kind, box: target.getBoundingClientRect() };
    applyPointer(event);
    emit(false);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag) return;
    applyPointer(event);
    emit(false);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drag) return;
    applyPointer(event);
    drag = null;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    sfx.play('tick');
    emit(true);
  }

  function onSvKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 0.1 : 0.01;
    let handled = true;
    if (event.key === 'ArrowLeft') sat = clamp01(sat - step);
    else if (event.key === 'ArrowRight') sat = clamp01(sat + step);
    else if (event.key === 'ArrowUp') val = clamp01(val + step);
    else if (event.key === 'ArrowDown') val = clamp01(val - step);
    else handled = false;
    if (!handled) return;
    event.preventDefault();
    sfx.play('tick');
    emit(true);
  }

  function onHueKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 10 : 1;
    let next = hue;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next = Math.min(360, hue + step);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next = Math.max(0, hue - step);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 360;
    else return;
    event.preventDefault();
    hue = next;
    sfx.play('tick');
    emit(true);
  }

  function commitHex(): void {
    if (hexDraft === null) return;
    const parsed = fromHex(hexDraft);
    if (!parsed) {
      if (hexDraft.trim() === '') hexDraft = null;
      return;
    }
    hexDraft = null;
    if (sameRgb(parsed, current)) return;
    adopt(parsed);
    sfx.play('tick');
    emit(true);
  }

  function onHexKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitHex();
    } else if (event.key === 'Escape' && hexDraft !== null) {
      event.preventDefault();
      event.stopPropagation();
      hexDraft = null;
    }
  }

  function setChannel(key: Channel, value: number): void {
    const next = { ...current, [key]: Math.max(0, Math.min(255, Math.round(value))) };
    channelDraft = { ...channelDraft, [key]: undefined };
    if (sameRgb(next, current)) return;
    adopt(next);
    sfx.play('tick');
    emit(true);
  }

  function commitChannel(key: Channel): void {
    const draft = channelDraft[key];
    if (draft === undefined) return;
    const value = Number.parseInt(draft.trim(), 10);
    if (Number.isFinite(value)) setChannel(key, value);
    else channelDraft = { ...channelDraft, [key]: undefined };
  }

  function onChannelKey(event: KeyboardEvent, key: Channel): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitChannel(key);
    } else if (event.key === 'Escape' && channelDraft[key] !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      channelDraft = { ...channelDraft, [key]: undefined };
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      setChannel(key, current[key] + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1));
    }
  }
</script>

<div class="picker" style:--hue={hueCss} style:--color={hex}>
  <div class="picker-area">
    <div
      class="sv"
      role="slider"
      tabindex="0"
      aria-label={t('paint.picker.square')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(sat * 100)}
      aria-valuetext={t('paint.picker.squareValue', { s: Math.round(sat * 100), v: Math.round(val * 100) })}
      onpointerdown={(event) => onPointerDown(event, 'sv')}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onkeydown={onSvKey}
    >
      <span class="sv-ring" style:left="{sat * 100}%" style:top="{(1 - val) * 100}%"></span>
    </div>
    <div
      class="hue"
      role="slider"
      tabindex="0"
      aria-label={t('paint.picker.hue')}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hue)}
      aria-valuetext={t('paint.picker.hueValue', { h: Math.round(hue) })}
      onpointerdown={(event) => onPointerDown(event, 'hue')}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onkeydown={onHueKey}
    >
      <span class="hue-thumb" style:top="{(1 - hue / 360) * 100}%"></span>
    </div>
  </div>
  <div class="picker-fields">
    <label class="picker-field picker-hex" for="{uid}-hex">
      <span class="picker-label">{t('paint.picker.hex')}</span>
      <input
        id="{uid}-hex"
        name="{uid}-hex"
        class="text-input picker-input"
        type="text"
        autocomplete="off"
        spellcheck="false"
        maxlength={7}
        aria-invalid={hexInvalid}
        title={hexInvalid ? t('paint.picker.invalidHex') : undefined}
        value={hexDraft ?? hex.toUpperCase()}
        oninput={(event) => (hexDraft = (event.currentTarget as HTMLInputElement).value)}
        onkeydown={onHexKey}
        onblur={commitHex}
      />
    </label>
    {#each CHANNELS as channel (channel.key)}
      <label class="picker-field" for="{uid}-{channel.key}" title={t(channel.label)}>
        <span class="picker-label" aria-hidden="true">{channel.short}</span>
        <input
          id="{uid}-{channel.key}"
          name="{uid}-{channel.key}"
          class="number-input picker-input"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          maxlength={3}
          aria-label={t(channel.label)}
          value={channelDraft[channel.key] ?? String(current[channel.key])}
          oninput={(event) => (channelDraft = { ...channelDraft, [channel.key]: (event.currentTarget as HTMLInputElement).value })}
          onkeydown={(event) => onChannelKey(event, channel.key)}
          onblur={() => commitChannel(channel.key)}
        />
      </label>
    {/each}
  </div>
</div>

<style>
  @layer components {
    .picker {
      display: grid;
      gap: var(--space-2);
      min-width: 0;
    }

    .picker-area {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 22px;
      gap: var(--space-2);
      height: 168px;
    }

    .sv,
    .hue {
      position: relative;
      border: 2px solid var(--line);
      border-radius: var(--radius-s);
      cursor: crosshair;
      touch-action: none;

      &:focus-visible {
        outline: 3px solid var(--focus);
        outline-offset: 2px;
      }
    }

    .sv {
      background:
        linear-gradient(to top, #000, transparent),
        linear-gradient(to right, #fff, var(--hue));
    }

    .hue {
      cursor: ns-resize;
      background: linear-gradient(to top, #f00 0%, #ff0 16.67%, #0f0 33.33%, #0ff 50%, #00f 66.67%, #f0f 83.33%, #f00 100%);
    }

    .sv-ring {
      position: absolute;
      width: 14px;
      height: 14px;
      translate: -50% -50%;
      background: var(--color);
      border: 2px solid var(--stage-white);
      border-radius: 50%;
      box-shadow:
        0 0 0 1px var(--stage-black),
        inset 0 0 0 1px var(--stage-black);
      pointer-events: none;
    }

    .hue-thumb {
      position: absolute;
      left: -4px;
      right: -4px;
      height: 6px;
      translate: 0 -50%;
      background: var(--hue);
      border: 2px solid var(--stage-white);
      border-radius: 3px;
      box-shadow: 0 0 0 1px var(--stage-black);
      pointer-events: none;
    }

    .picker-fields {
      display: grid;
      grid-template-columns: minmax(0, 1.6fr) repeat(3, minmax(0, 1fr));
      gap: var(--space-1);
    }

    .picker-field {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .picker-label {
      color: var(--text-faint);
      font-size: 0.6875rem;
      font-weight: 800;
      text-align: center;
    }

    .picker-input {
      min-height: 30px;
      padding: 0 6px;
      font-size: 0.8125rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .picker-hex .picker-input {
      font-family: var(--font-mono);
      text-transform: uppercase;
    }
  }
</style>
