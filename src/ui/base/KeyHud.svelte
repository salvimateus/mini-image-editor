<script lang="ts">
  import { app } from '../../app/state.svelte.ts';
  import { keyHud } from '../../app/key-hud.svelte.ts';
  import { t } from '../../app/i18n/index.ts';
  import { TUNING } from '../../app/tuning/index.ts';

  const item = $derived(app.view.hud ? keyHud.item : null);
</script>

<div class="hud-anchor" aria-live="polite" aria-label={t('chrome.hud')}>
  {#if item}
    {#key item.serial}
      <div
        class="hud"
        class:is-hint={item.mode === 'hint'}
        style:--hud-ms="{item.mode === 'hint' ? TUNING.ui.keyHud.hintMs : TUNING.ui.keyHud.pressMs}ms"
      >
        <span class="hud-keys">
          {#each item.keys as label, index (index)}
            <kbd class="keycap hud-key" style:--i={index}>{label}</kbd>
            {#if index < item.keys.length - 1}<span class="hud-plus" aria-hidden="true">+</span>{/if}
          {/each}
        </span>
        <span class="hud-label">{item.label}</span>
      </div>
    {/key}
  {/if}
</div>

<style>
  @layer components {
    .hud-anchor {
      position: absolute;
      left: 50%;
      bottom: var(--space-4);
      z-index: 20;
      translate: -50% 0;
      pointer-events: none;
    }

    .hud {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-4) var(--space-2) var(--space-2);
      background: color-mix(in oklch, var(--surface-2), transparent 6%);
      border: 2px solid var(--line-strong);
      border-radius: var(--radius-pill);
      box-shadow: 0 5px 0 var(--depth);
      font-size: 1.125rem;
      white-space: nowrap;
      animation: hud-life var(--hud-ms) var(--ease-sym) forwards;

      &.is-hint {
        border-color: var(--primary-edge);
      }
    }

    .hud-keys {
      display: inline-flex;
      align-items: center;
      gap: 0.3em;
    }

    .hud-key {
      animation: hud-press 260ms var(--ease-spring) calc(var(--i) * 60ms) both;

      .is-hint & {
        animation: hud-tap 640ms var(--ease-sym) calc(var(--i) * 120ms) 3 both;
      }
    }

    .hud-plus {
      color: var(--text-faint);
      font-weight: 800;
      font-size: 0.8em;
    }

    .hud-label {
      font-weight: 800;
      font-size: 0.9375rem;
    }

    /* The global rule shortens every animation; the HUD stays still instead and leaves when its item ends. */
    @media (prefers-reduced-motion: reduce) {
      .hud,
      .hud-key,
      .is-hint .hud-key {
        animation: none;
      }
    }

    @keyframes hud-life {
      0% {
        opacity: 0;
        transform: translateY(10px) scale(0.92);
      }
      8% {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
      82% {
        opacity: 1;
        transform: translateY(0);
      }
      100% {
        opacity: 0;
        transform: translateY(6px);
      }
    }

    @keyframes hud-press {
      0% {
        transform: translateY(0);
      }
      40% {
        transform: translateY(0.14em);
        box-shadow: 0 0.02em 0 var(--depth);
        color: var(--on-primary);
        background: var(--primary);
      }
      100% {
        transform: translateY(0);
      }
    }

    @keyframes hud-tap {
      0%,
      100% {
        transform: translateY(0);
      }
      45% {
        transform: translateY(0.12em);
        box-shadow: 0 0.04em 0 var(--depth);
        background-color: var(--primary-fill);
      }
    }
  }
</style>
