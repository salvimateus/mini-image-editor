<script lang="ts">
  import { toCss, toHex } from '../../core/color.ts';
  import type { Rgba } from '../../core/types.ts';
  import { t } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';
  import ColorPicker from './ColorPicker.svelte';

  interface Props {
    id: string;
    label: string;
    color: Rgba;
    onchange: (color: Rgba) => void;
  }

  let { id, label, color, onchange }: Props = $props();

  const EDGE_PX = 8;
  const GAP_PX = 6;
  /** WebKitGTK before 2.42 has no popover: the picker then opens as a fixed box with the same placement. */
  const nativePopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

  let button = $state<HTMLButtonElement | null>(null);
  let pop = $state<HTMLDivElement | null>(null);
  let open = $state(false);
  /** The color during a drag of the picker, before the change ends. */
  let live = $state<Rgba | null>(null);

  const shown = $derived(live ?? color);
  const popId = $derived(`${id}-popover`);

  /** Below the button when it fits, else above; always inside the window. */
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
      sfx.play('tick');
    } else {
      live = null;
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

  // While open: a resize or a scroll moves the button, so the picker closes. The fallback also closes on Escape and outside press.
  $effect(() => {
    if (!open) return;
    const onResize = () => close();
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
    window.addEventListener('scroll', onResize, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPress, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPress, true);
    };
  });
</script>

<div class="color-field">
  <button
    bind:this={button}
    {id}
    type="button"
    class="color-field-btn"
    popovertarget={nativePopover ? popId : undefined}
    aria-label={t('paint.field.choose', { label })}
    aria-expanded={open}
    aria-controls={popId}
    onclick={onFallbackClick}
  >
    <span class="color-field-swatch" style:--swatch={toCss({ ...shown, a: 255 })}></span>
    <span class="color-field-text">
      <span class="color-field-label">{label}</span>
      <span class="color-field-hex">{toHex(shown).toUpperCase()}</span>
    </span>
  </button>
  <div
    bind:this={pop}
    id={popId}
    class="color-field-pop"
    class:is-fallback={!nativePopover}
    class:is-open={open}
    popover={nativePopover ? 'auto' : undefined}
    ontoggle={onToggle}
  >
    <ColorPicker
      color={shown}
      oninput={(next) => (live = next)}
      onchange={(next) => {
        live = null;
        onchange(next);
      }}
    />
  </div>
</div>

<style>
  @layer components {
    .color-field {
      min-width: 0;
    }

    .color-field-btn {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      min-height: 36px;
      padding: 3px var(--space-2) 3px 3px;
      text-align: left;
      background: var(--surface-sunken);
      border: 2px solid var(--line);
      border-radius: var(--radius-s);
      transition:
        border-color var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover {
        border-color: var(--line-strong);
      }

      &:active {
        transform: translateY(1px);
        transition-duration: 60ms;
      }

      &[aria-expanded='true'] {
        border-color: var(--primary-edge);
      }
    }

    .color-field-swatch {
      flex: none;
      width: 26px;
      height: 26px;
      background: var(--swatch);
      border: 2px solid var(--hairline-strong);
      border-radius: 6px;
      box-shadow: 0 0 0 1px var(--depth);
    }

    .color-field-text {
      display: grid;
      min-width: 0;
      line-height: 1.15;
    }

    .color-field-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-muted);
      font-size: 0.75rem;
      font-weight: 700;
    }

    .color-field-hex {
      color: var(--text);
      font: 700 0.8125rem/1.2 var(--font-mono);
    }

    .color-field-pop {
      position: fixed;
      inset: auto;
      top: 0;
      left: 0;
      width: 260px;
      margin: 0;
      padding: var(--space-3);
      color: var(--text);
      background: var(--surface-2);
      border: 2px solid var(--line-strong);
      border-radius: var(--radius-m);
      box-shadow: 0 10px 28px var(--depth);

      &:popover-open {
        animation: color-pop-in var(--dur-pop) var(--ease-out);
      }

      &.is-fallback {
        z-index: 50;
        display: none;

        &.is-open {
          display: block;
        }
      }
    }

    @keyframes color-pop-in {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
    }
  }
</style>
