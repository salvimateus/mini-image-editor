<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import WifiOff from '@lucide/svelte/icons/wifi-off';
  import { BUNDLED_FAMILY, familyStack } from '../../app/fonts/fonts.ts';
  import { textSession } from '../../app/fonts/text-session.svelte.ts';
  import { getLocale, parseDecimal, t } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import ColorField from '../panels/ColorField.svelte';
  import FontPicker from '../panels/FontPicker.svelte';

  const EDGE_PX = 8;
  const GAP_PX = 6;
  const R = TUNING.text.ranges.size;
  /** WebKitGTK before 2.42 has no popover: the picker then opens as a fixed box with the same placement. */
  const nativePopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
  const format = $derived(new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1, useGrouping: false }));

  let button = $state<HTMLButtonElement | null>(null);
  let pop = $state<HTMLDivElement | null>(null);
  let open = $state(false);
  let sizeDraft = $state<string | null>(null);

  const spec = $derived(textSession.shown);
  const editing = $derived(textSession.target !== null);
  const busy = $derived(spec.family !== BUNDLED_FAMILY && textSession.font === 'loading');
  const offline = $derived(spec.family !== BUNDLED_FAMILY && textSession.font === 'offline');

  function place(): void {
    if (!button || !pop) return;
    const box = button.getBoundingClientRect();
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    const x = Math.max(EDGE_PX, Math.min(window.innerWidth - EDGE_PX - width, box.left));
    const below = box.bottom + GAP_PX;
    const y = below + height <= window.innerHeight - EDGE_PX ? below : Math.max(EDGE_PX, box.top - GAP_PX - height);
    pop.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
  }

  function close(): void {
    if (nativePopover) pop?.hidePopover();
    else open = false;
  }

  function onToggle(event: ToggleEvent): void {
    open = event.newState === 'open';
    if (open) {
      place();
      // The picker renders on open, so its height is known one frame later.
      requestAnimationFrame(place);
      sfx.play('tick');
    }
  }

  function onFallbackClick(): void {
    if (nativePopover) return;
    open = !open;
    if (open) {
      sfx.play('tick');
      requestAnimationFrame(place);
    }
  }

  // While open: a resize or a page scroll moves the button, so the picker closes; the scroll of its own list does not.
  $effect(() => {
    if (!open) return;
    const onResize = () => close();
    const onScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && pop?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !nativePopover) {
        event.preventDefault();
        close();
      }
    };
    const onPress = (event: PointerEvent) => {
      if (nativePopover) return;
      const target = event.target as Node | null;
      if (target && (pop?.contains(target) || button?.contains(target))) return;
      close();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPress, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPress, true);
    };
  });

  function setSize(value: number): void {
    const next = Math.round(Math.min(R.max, Math.max(R.min, value)));
    sizeDraft = null;
    if (next === spec.size) return;
    sfx.play('tick');
    textSession.update({ size: next }, 'size');
  }

  function commitSize(): void {
    if (sizeDraft === null) return;
    const parsed = parseDecimal(sizeDraft);
    if (parsed === null) {
      sizeDraft = null;
      return;
    }
    setSize(parsed);
  }

  function onSizeKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitSize();
    } else if (event.key === 'Escape' && sizeDraft !== null) {
      event.preventDefault();
      event.stopPropagation();
      sizeDraft = null;
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      setSize(spec.size + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1));
    }
  }
</script>

<div class="text-options">
  {#if !editing}
    <span class="text-options-tag">{t('text.options.next')}</span>
  {/if}
  <button
    bind:this={button}
    type="button"
    class="text-input text-options-font"
    popovertarget={nativePopover ? 'text-options-picker' : undefined}
    aria-expanded={open}
    aria-controls="text-options-picker"
    aria-label="{t('text.font')}: {spec.family}"
    title={t('text.picker.open')}
    onclick={onFallbackClick}
  >
    <span class="text-options-name" style:font-family={familyStack(spec.family)} style:font-weight={spec.weight} style:font-style={spec.italic ? 'italic' : 'normal'}>
      {spec.family}
    </span>
    {#if busy}
      <LoaderCircle class="text-options-spin" size={16} aria-label={t('text.picker.loading')} />
    {:else if offline}
      <WifiOff size={16} aria-label={t('text.picker.offline')} />
    {/if}
    <ChevronDown size={16} aria-hidden="true" />
  </button>

  <label class="text-options-size">
    <span class="text-options-label">{t('text.size')}</span>
    <input
      id="text-options-size"
      name="text-options-size"
      class="number-input"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      aria-label={t('text.options.size')}
      value={sizeDraft ?? format.format(spec.size)}
      oninput={(event) => (sizeDraft = event.currentTarget.value)}
      onkeydown={onSizeKey}
      onblur={commitSize}
    />
    <span class="text-options-unit" aria-hidden="true">px</span>
  </label>

  <div class="text-options-color">
    <ColorField id="text-options-color" label={t('text.color')} color={spec.color} onchange={(color) => textSession.update({ color }, 'color')} />
  </div>

  <div
    bind:this={pop}
    id="text-options-picker"
    class="text-options-pop"
    class:is-fallback={!nativePopover}
    class:is-open={open}
    popover={nativePopover ? 'auto' : undefined}
    ontoggle={onToggle}
  >
    {#if open}
      <FontPicker id="text-options-font" family={spec.family} status={textSession.font} onpick={(family) => textSession.setFamily(family)} onretry={() => textSession.retry()} autofocus />
    {/if}
  </div>
</div>

<style>
  @layer components {
    .text-options {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;
    }

    .text-options-tag {
      flex: none;
      padding: 3px 8px;
      color: var(--text-muted);
      background: var(--surface-3);
      border-radius: var(--radius-pill);
      font: 800 0.75rem/1 var(--font-display);
      white-space: nowrap;
    }

    .text-options-font {
      display: flex;
      flex: none;
      align-items: center;
      gap: var(--space-2);
      width: 200px;
      min-height: 32px;
      color: var(--text);
      cursor: pointer;

      &[aria-expanded='true'] {
        border-color: var(--primary-edge);
      }
    }

    .text-options-name {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
      font-size: 0.9375rem;
    }

    .text-options-size {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: 6px;

      & .number-input {
        width: 4rem;
        min-height: 32px;
      }
    }

    :is(.text-options-label, .text-options-unit) {
      color: var(--text-muted);
      font-size: 0.8125rem;
      font-weight: 700;
      white-space: nowrap;
    }

    .text-options-color {
      flex: none;
      width: 150px;
    }

    .text-options-pop {
      position: fixed;
      inset: auto;
      top: 0;
      left: 0;
      width: 320px;
      margin: 0;
      padding: var(--space-3);
      color: var(--text);
      background: var(--surface-2);
      border: 2px solid var(--line-strong);
      border-radius: var(--radius-m);
      box-shadow: 0 10px 28px var(--depth);

      &:popover-open {
        animation: text-pop-in var(--dur-pop) var(--ease-out);
      }

      &.is-fallback {
        z-index: 50;
        display: none;

        &.is-open {
          display: block;
        }
      }
    }

    .text-options :global(.text-options-spin) {
      flex: none;
      color: var(--primary);
      animation: text-options-spin 900ms linear infinite;
    }

    @keyframes text-options-spin {
      to {
        rotate: 1turn;
      }
    }

    @keyframes text-pop-in {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
    }
  }
</style>
