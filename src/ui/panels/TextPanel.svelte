<script lang="ts">
  import AlignCenter from '@lucide/svelte/icons/align-center';
  import AlignLeft from '@lucide/svelte/icons/align-left';
  import AlignRight from '@lucide/svelte/icons/align-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Type from '@lucide/svelte/icons/type';
  import WifiOff from '@lucide/svelte/icons/wifi-off';
  import { onMount, tick, untrack } from 'svelte';
  import type { Rgba, TextSpec } from '../../core/types.ts';
  import { BUNDLED_FAMILY, familyInfo, familyStack, loadCatalog, weightsOf } from '../../app/fonts/fonts.ts';
  import { textSession } from '../../app/fonts/text-session.svelte.ts';
  import { t, type TextKey } from '../../app/i18n/index.ts';
  import KeyText from '../base/KeyText.svelte';
  import * as sfx from '../../app/sfx.ts';
  import { app } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import Keys from '../base/Keys.svelte';
  import SliderField from '../base/SliderField.svelte';
  import ToggleSwitch from '../base/ToggleSwitch.svelte';
  import ColorField from './ColorField.svelte';
  import FontPicker from './FontPicker.svelte';

  const WEIGHT_KEYS: Record<number, TextKey> = {
    100: 'text.weight.100',
    200: 'text.weight.200',
    300: 'text.weight.300',
    400: 'text.weight.400',
    500: 'text.weight.500',
    600: 'text.weight.600',
    700: 'text.weight.700',
    800: 'text.weight.800',
    900: 'text.weight.900',
  };
  const CASES: readonly { id: TextSpec['transform']; label: string; title: TextKey }[] = [
    { id: 'none', label: 'Aa', title: 'text.case.none' },
    { id: 'upper', label: 'AB', title: 'text.case.upper' },
    { id: 'lower', label: 'ab', title: 'text.case.lower' },
    { id: 'capitalize', label: 'Ab Cd', title: 'text.case.capitalize' },
  ];
  const ALIGNS = [
    { id: 'left', icon: AlignLeft, title: 'text.align.left' },
    { id: 'center', icon: AlignCenter, title: 'text.align.center' },
    { id: 'right', icon: AlignRight, title: 'text.align.right' },
  ] as const satisfies readonly { id: TextSpec['align']; icon: unknown; title: TextKey }[];
  const R = TUNING.text.ranges;
  const D = TUNING.text.defaults;

  let field = $state<HTMLTextAreaElement | null>(null);
  let pickerOpen = $state(false);
  /** familyInfo reads the catalog, which loads once; this makes the weight menu follow it. */
  let catalogTick = $state(0);

  const target = $derived(textSession.target);
  const spec = $derived(target?.spec ?? null);
  const info = $derived.by(() => {
    void catalogTick;
    return spec ? familyInfo(spec.family) : null;
  });
  const weights = $derived(spec ? (info ? weightsOf(info, spec.italic) : [spec.weight]) : []);
  const italicShown = $derived(!!info && info.italics.length > 0 && info.weights.length > 0);
  const fontBusy = $derived(!!spec && spec.family !== BUNDLED_FAMILY && textSession.font === 'loading');
  const fontOffline = $derived(!!spec && spec.family !== BUNDLED_FAMILY && textSession.font === 'offline');

  function weightName(weight: number): string {
    const key = WEIGHT_KEYS[weight];
    // The name alone: the number is jargon, and it does not fit the narrow panel.
    return key ? t(key) : String(weight);
  }

  onMount(() => {
    void loadCatalog().then(() => (catalogTick += 1));
    // The panel closes: an empty text goes away, with no undo step left behind.
    return () => textSession.end();
  });

  // A text layer that becomes active (here, in the Layers panel or by undo) starts its own editing session.
  $effect(() => {
    void target;
    untrack(() => textSession.follow());
  });

  $effect(() => {
    void textSession.focusTick;
    void tick().then(() => {
      if (!field) return;
      field.focus();
      const end = field.value.length;
      field.setSelectionRange(end, end);
    });
  });

  function onFieldKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    sfx.play('tick');
    app.openPanel('none');
  }

  function togglePicker(): void {
    sfx.play('tick');
    pickerOpen = !pickerOpen;
  }

  function pickFamily(family: string): void {
    textSession.setFamily(family);
  }

  function setCase(id: TextSpec['transform']): void {
    if (spec?.transform === id) return;
    sfx.play('tick');
    textSession.update({ transform: id });
  }

  function setAlign(id: TextSpec['align']): void {
    if (spec?.align === id) return;
    sfx.play('tick');
    textSession.update({ align: id });
  }

  function shadowColor(color: Rgba): void {
    textSession.update({ shadow: { color: { ...color, a: spec?.shadow.color.a ?? 255 } } }, 'shadow-color');
  }

  function shadowOpacity(percent: number, coalesce: string): void {
    if (!spec) return;
    textSession.update({ shadow: { color: { ...spec.shadow.color, a: Math.round((percent / 100) * 255) } } }, coalesce);
  }
</script>

<section class="side-panel text-panel" aria-labelledby="panel-text-title">
  <h2 id="panel-text-title" class="section-title">{t('chrome.tool.text')}</h2>

  {#if !spec}
    <div class="text-empty">
      <Type size={28} aria-hidden="true" />
      <p class="hint">{t('text.panel.empty')}</p>
      {#if app.tool !== 'text'}
        <button type="button" class="btn btn-small" onclick={() => app.setTool('text')}>
          {t('text.panel.toolKey')}
          <Keys id="tool.text" />
        </button>
      {/if}
    </div>
  {:else}
    <div class="field">
      <label class="field-label" for="text-field">{t('text.field')}</label>
      <textarea
        bind:this={field}
        id="text-field"
        name="text-field"
        class="text-input text-area"
        rows="3"
        spellcheck="false"
        placeholder={t('text.field.placeholder')}
        aria-describedby="text-field-help"
        value={spec.text}
        oninput={(event) => textSession.update({ text: event.currentTarget.value }, 'typing')}
        onkeydown={onFieldKey}
      ></textarea>
      <span id="text-field-help" class="text-help"><KeyText text={t('text.field.help')} /></span>
    </div>

    <div class="field">
      <span class="field-label" id="text-font-label">{t('text.font')}</span>
      <button
        type="button"
        class="text-input font-button"
        aria-labelledby="text-font-label"
        aria-expanded={pickerOpen}
        aria-controls="text-font-picker"
        title={pickerOpen ? t('text.picker.close') : t('text.picker.open')}
        onclick={togglePicker}
      >
        <span class="font-button-name" style:font-family={familyStack(spec.family)} style:font-weight={spec.weight} style:font-style={spec.italic ? 'italic' : 'normal'}>
          {spec.family}
        </span>
        {#if fontBusy}
          <LoaderCircle class="text-spin" size={16} aria-label={t('text.picker.loading')} />
        {:else if fontOffline}
          <WifiOff size={16} aria-label={t('text.picker.offline')} />
        {/if}
        <ChevronDown class="font-button-chevron" size={16} aria-hidden="true" />
      </button>
    </div>

    {#if pickerOpen}
      <div id="text-font-picker" class="text-picker">
        <FontPicker id="text-panel-font" family={spec.family} status={textSession.font} onpick={pickFamily} onretry={() => textSession.retry()} autofocus />
      </div>
    {:else if fontOffline}
      <p class="text-offline" role="status">
        <WifiOff size={16} aria-hidden="true" />
        <span>{t('text.picker.offline')}</span>
        <button type="button" class="btn btn-small btn-quiet" onclick={() => textSession.retry()}>{t('text.picker.retry')}</button>
      </p>
    {/if}

    <div class="text-row">
      <div class="field">
        <label class="field-label" for="text-weight">{t('text.weight')}</label>
        <select
          id="text-weight"
          name="text-weight"
          class="select-input"
          value={spec.weight}
          disabled={weights.length < 2}
          onchange={(event) => {
            sfx.play('tick');
            textSession.setWeight(Number(event.currentTarget.value));
          }}
        >
          {#each weights as weight (weight)}
            <option value={weight}>{weightName(weight)}</option>
          {/each}
        </select>
      </div>
      {#if italicShown}
        <div class="text-italic">
          <ToggleSwitch id="text-italic" label={t('text.italic')} checked={spec.italic} onchange={(value) => textSession.setItalic(value)} />
        </div>
      {/if}
    </div>

    <SliderField
      id="text-size"
      label={t('text.size')}
      value={spec.size}
      min={R.size.min}
      max={R.size.max}
      step={R.size.step}
      unit="px"
      reset={D.size}
      oninput={(value) => textSession.update({ size: value }, 'size')}
      onchange={(value) => textSession.update({ size: value }, 'size')}
    />
    <SliderField
      id="text-spacing"
      label={t('text.letterSpacing')}
      value={spec.letterSpacing}
      min={R.letterSpacing.min}
      max={R.letterSpacing.max}
      step={R.letterSpacing.step}
      unit="px"
      reset={D.letterSpacing}
      oninput={(value) => textSession.update({ letterSpacing: value }, 'spacing')}
      onchange={(value) => textSession.update({ letterSpacing: value }, 'spacing')}
    />
    <SliderField
      id="text-line-height"
      label={t('text.lineHeight')}
      value={spec.lineHeight}
      min={R.lineHeight.min}
      max={R.lineHeight.max}
      step={R.lineHeight.step}
      unit="×"
      reset={D.lineHeight}
      oninput={(value) => textSession.update({ lineHeight: value }, 'line-height')}
      onchange={(value) => textSession.update({ lineHeight: value }, 'line-height')}
    />

    <div class="field">
      <span class="field-label" id="text-case-label">{t('text.case')}</span>
      <div class="segmented" role="group" aria-labelledby="text-case-label">
        {#each CASES as entry (entry.id)}
          <button type="button" aria-pressed={spec.transform === entry.id} title={t(entry.title)} aria-label={t(entry.title)} onclick={() => setCase(entry.id)}>
            {entry.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="text-row">
      <div class="field">
        <span class="field-label" id="text-align-label">{t('text.align')}</span>
        <div class="segmented" role="group" aria-labelledby="text-align-label">
          {#each ALIGNS as entry (entry.id)}
            {@const Icon = entry.icon}
            <button type="button" aria-pressed={spec.align === entry.id} title={t(entry.title)} aria-label={t(entry.title)} onclick={() => setAlign(entry.id)}>
              <Icon size={16} aria-hidden="true" />
            </button>
          {/each}
        </div>
      </div>
      <ColorField id="text-color" label={t('text.color')} color={spec.color} onchange={(color) => textSession.update({ color }, 'color')} />
    </div>

    <div class="text-group">
      <ToggleSwitch id="text-stroke" label={t('text.stroke')} checked={spec.stroke.on} onchange={(on) => textSession.update({ stroke: { on } })} />
      {#if spec.stroke.on}
        <SliderField
          id="text-stroke-width"
          label={t('text.stroke.width')}
          value={spec.stroke.width}
          min={R.strokeWidth.min}
          max={R.strokeWidth.max}
          step={R.strokeWidth.step}
          unit="px"
          reset={D.stroke.width}
          oninput={(value) => textSession.update({ stroke: { width: value } }, 'stroke-width')}
          onchange={(value) => textSession.update({ stroke: { width: value } }, 'stroke-width')}
        />
        <ColorField id="text-stroke-color" label={t('text.stroke.color')} color={spec.stroke.color} onchange={(color) => textSession.update({ stroke: { color } }, 'stroke-color')} />
      {/if}
    </div>

    <div class="text-group">
      <ToggleSwitch id="text-shadow" label={t('text.shadow')} checked={spec.shadow.on} onchange={(on) => textSession.update({ shadow: { on } })} />
      {#if spec.shadow.on}
        <div class="text-row">
          <SliderField
            id="text-shadow-dx"
            label={t('text.shadow.dx')}
            value={spec.shadow.dx}
            min={R.shadowOffset.min}
            max={R.shadowOffset.max}
            step={R.shadowOffset.step}
            unit="px"
            reset={D.shadow.dx}
            oninput={(value) => textSession.update({ shadow: { dx: value } }, 'shadow-dx')}
            onchange={(value) => textSession.update({ shadow: { dx: value } }, 'shadow-dx')}
          />
          <SliderField
            id="text-shadow-dy"
            label={t('text.shadow.dy')}
            value={spec.shadow.dy}
            min={R.shadowOffset.min}
            max={R.shadowOffset.max}
            step={R.shadowOffset.step}
            unit="px"
            reset={D.shadow.dy}
            oninput={(value) => textSession.update({ shadow: { dy: value } }, 'shadow-dy')}
            onchange={(value) => textSession.update({ shadow: { dy: value } }, 'shadow-dy')}
          />
        </div>
        <SliderField
          id="text-shadow-blur"
          label={t('text.shadow.blur')}
          value={spec.shadow.blur}
          min={R.shadowBlur.min}
          max={R.shadowBlur.max}
          step={R.shadowBlur.step}
          unit="px"
          reset={D.shadow.blur}
          oninput={(value) => textSession.update({ shadow: { blur: value } }, 'shadow-blur')}
          onchange={(value) => textSession.update({ shadow: { blur: value } }, 'shadow-blur')}
        />
        <ColorField id="text-shadow-color" label={t('text.shadow.color')} color={spec.shadow.color} onchange={shadowColor} />
        <SliderField
          id="text-shadow-opacity"
          label={t('text.shadow.opacity')}
          value={Math.round((spec.shadow.color.a / 255) * 100)}
          min={0}
          max={100}
          step={1}
          unit="%"
          reset={Math.round((D.shadow.color.a / 255) * 100)}
          oninput={(value) => shadowOpacity(value, 'shadow-opacity')}
          onchange={(value) => shadowOpacity(value, 'shadow-opacity')}
        />
      {/if}
    </div>
  {/if}
</section>

<style>
  @layer components {
    .text-panel {
      padding-top: var(--space-3);
    }

    .text-empty {
      display: grid;
      justify-items: center;
      gap: var(--space-2);
      padding: var(--space-3);
      color: var(--text-faint);
      text-align: center;
      background: var(--surface-sunken);
      border: 2px dashed var(--line);
      border-radius: var(--radius-m);
    }

    .text-area {
      min-height: 76px;
      padding: var(--space-2);
      resize: vertical;
      font-size: 0.9375rem;
      line-height: 1.4;
    }

    .text-help {
      color: var(--text-faint);
      font-size: 0.75rem;
    }

    .font-button {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      text-align: left;
      cursor: pointer;

      &[aria-expanded='true'] {
        border-color: var(--primary-edge);

        & :global(.font-button-chevron) {
          rotate: 180deg;
        }
      }

      & :global(.font-button-chevron) {
        flex: none;
        color: var(--text-faint);
        transition: rotate var(--dur-pop) var(--ease-out);
      }
    }

    .font-button-name {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 1.0625rem;
    }

    .text-picker {
      animation: text-picker-in var(--dur-pop) var(--ease-out);
    }

    .text-offline {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--danger-text);
      font-size: 0.8125rem;
      font-weight: 700;
      line-height: 1.3;

      & span {
        flex: 1 1 auto;
        min-width: 0;
      }
    }

    .text-row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: end;
      gap: var(--space-3);
    }

    .text-italic {
      padding-bottom: 6px;
    }

    .text-group {
      display: grid;
      gap: var(--space-3);
      padding-top: var(--space-3);
      border-top: 2px solid var(--line);
    }

    .text-panel :global(.text-spin) {
      flex: none;
      color: var(--primary);
      animation: text-spin 900ms linear infinite;
    }

    @keyframes text-spin {
      to {
        rotate: 1turn;
      }
    }

    @keyframes text-picker-in {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
    }
  }
</style>
