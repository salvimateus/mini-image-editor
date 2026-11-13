<script lang="ts">
  import { getLocale, parseDecimal, t } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';

  interface Props {
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    /** A short unit after the number, such as `px` or `%`. */
    unit?: string;
    disabled?: boolean;
    /** A double-click on the label goes back to this value. */
    reset?: number;
    /** Each move of a drag. */
    oninput: (value: number) => void;
    /** The end of a drag, a typed value, an arrow key or a reset. */
    onchange: (value: number) => void;
  }

  let { id, label, value, min, max, step, unit, disabled = false, reset, oninput, onchange }: Props = $props();

  const decimals = $derived(step > 0 && step < 1 ? Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)) : 0);
  const formatter = $derived(new Intl.NumberFormat(getLocale(), { maximumFractionDigits: decimals, useGrouping: false }));
  const fill = $derived(max > min ? ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100 : 0);

  let draft = $state<string | null>(null);
  const shown = $derived(draft ?? formatter.format(value));

  function snap(next: number): number {
    const clamped = Math.min(max, Math.max(min, next));
    const steps = Math.round((clamped - min) / step);
    const snapped = Math.min(max, min + steps * step);
    return Number(snapped.toFixed(decimals));
  }

  function commitDraft(): void {
    if (draft === null) return;
    const parsed = parseDecimal(draft);
    draft = null;
    if (parsed === null) return;
    const next = snap(parsed);
    if (next !== value) {
      sfx.play('tick');
      onchange(next);
    }
  }

  function stepBy(direction: 1 | -1, big: boolean): void {
    const next = snap(value + direction * step * (big ? 10 : 1));
    draft = null;
    if (next === value) return;
    sfx.play('tick');
    onchange(next);
  }

  function onFieldKey(event: KeyboardEvent): void {
    // Enter commits the number and goes on: a dialog submits, a panel applies.
    if (event.key === 'Enter') {
      commitDraft();
    } else if (event.key === 'Escape' && draft !== null) {
      event.preventDefault();
      event.stopPropagation();
      draft = null;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      stepBy(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey);
    }
  }

  function onRangeInput(event: Event): void {
    const next = Number((event.currentTarget as HTMLInputElement).value);
    draft = null;
    sfx.play('tick');
    oninput(next);
  }

  function onRangeChange(event: Event): void {
    onchange(Number((event.currentTarget as HTMLInputElement).value));
  }

  function onReset(): void {
    if (disabled || reset === undefined) return;
    draft = null;
    sfx.play('tick');
    onchange(snap(reset));
  }
</script>

<div class="slider-field" class:is-disabled={disabled}>
  <div class="slider-head">
    <label
      class="slider-label"
      for={id}
      title={reset === undefined ? undefined : t('slider.reset', { value: formatter.format(reset) })}
      ondblclick={onReset}>{label}</label
    >
    <span class="slider-value">
      <input
        {id}
        name={id}
        class="number-input slider-number"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        spellcheck="false"
        {disabled}
        value={shown}
        oninput={(event) => (draft = (event.currentTarget as HTMLInputElement).value)}
        onkeydown={onFieldKey}
        onblur={commitDraft}
      />
      {#if unit}<span class="slider-unit" aria-hidden="true">{unit}</span>{/if}
    </span>
  </div>
  <input
    id="{id}-range"
    name="{id}-range"
    class="slider-range"
    type="range"
    aria-label={label}
    {min}
    {max}
    {step}
    {value}
    {disabled}
    style:--fill="{fill}%"
    oninput={onRangeInput}
    onchange={onRangeChange}
  />
</div>

<style>
  @layer components {
    .slider-field {
      display: grid;
      gap: var(--space-1);
      min-width: 0;

      &.is-disabled {
        opacity: 0.5;
      }
    }

    .slider-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }

    .slider-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-muted);
      font-size: 0.8125rem;
      font-weight: 700;
      cursor: default;
    }

    .slider-value {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex: none;
    }

    .slider-number {
      width: 4.25rem;
      min-height: 28px;
      padding: 0 6px;
      font-size: 0.8125rem;
      font-weight: 700;
    }

    .slider-unit {
      color: var(--text-faint);
      font-size: 0.75rem;
      font-weight: 700;
    }

    .slider-range {
      --thumb: 18px;
      appearance: none;
      width: 100%;
      height: 24px;
      margin: 0;
      background: transparent;
      cursor: pointer;

      &:disabled {
        cursor: not-allowed;
      }

      &::-webkit-slider-runnable-track {
        height: 8px;
        border-radius: var(--radius-pill);
        background: linear-gradient(to right, var(--primary) var(--fill), var(--surface-sunken) var(--fill));
        border: 1px solid var(--line);
      }

      &::-moz-range-track {
        height: 8px;
        border-radius: var(--radius-pill);
        background: linear-gradient(to right, var(--primary) var(--fill), var(--surface-sunken) var(--fill));
        border: 1px solid var(--line);
      }

      &::-webkit-slider-thumb {
        appearance: none;
        width: var(--thumb);
        height: var(--thumb);
        margin-top: calc((8px - var(--thumb)) / 2 - 1px);
        background: var(--text);
        border: 3px solid var(--primary-edge);
        border-radius: var(--radius-pill);
        box-shadow: 0 2px 0 var(--depth);
        transition: transform var(--dur-hover) var(--ease-spring);
      }

      &::-moz-range-thumb {
        width: var(--thumb);
        height: var(--thumb);
        background: var(--text);
        border: 3px solid var(--primary-edge);
        border-radius: var(--radius-pill);
        box-shadow: 0 2px 0 var(--depth);
        transition: transform var(--dur-hover) var(--ease-spring);
      }

      &:hover:not(:disabled)::-webkit-slider-thumb {
        transform: scale(1.12);
      }

      &:active:not(:disabled)::-webkit-slider-thumb {
        transform: scale(1.22);
      }

      &:hover:not(:disabled)::-moz-range-thumb {
        transform: scale(1.12);
      }

      &:active:not(:disabled)::-moz-range-thumb {
        transform: scale(1.22);
      }

      &:focus-visible {
        outline: none;
      }

      &:focus-visible::-webkit-slider-thumb {
        outline: 3px solid var(--focus);
        outline-offset: 2px;
      }

      &:focus-visible::-moz-range-thumb {
        outline: 3px solid var(--focus);
        outline-offset: 2px;
      }
    }
  }
</style>
