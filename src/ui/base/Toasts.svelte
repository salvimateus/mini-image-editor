<script lang="ts">
  import type { Component } from 'svelte';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import Info from '@lucide/svelte/icons/info';
  import X from '@lucide/svelte/icons/x';
  import { app, type ToastItem, type ToastKind } from '../../app/state.svelte.ts';
  import { t } from '../../app/i18n/index.ts';
  import KeyText from './KeyText.svelte';

  const ICONS: Record<ToastKind, Component<{ size?: number | string }>> = { info: Info, success: CircleCheck, error: CircleAlert };

  function runAction(toast: ToastItem): void {
    app.dismissToast(toast.id);
    toast.action?.run();
  }
</script>

<div class="toasts" role="status" aria-live="polite" aria-atomic="false">
  {#each app.toasts as toast (toast.id)}
    {@const Icon = ICONS[toast.kind]}
    <div class="toast toast-{toast.kind}">
      <span class="toast-icon"><Icon size={20} /></span>
      <p class="toast-text"><KeyText text={toast.text} /></p>
      {#if toast.action}
        <button type="button" class="btn btn-small toast-action" onclick={() => runAction(toast)}>{toast.action.label}</button>
      {/if}
      <button type="button" class="toast-close" aria-label={t('toast.close')} onclick={() => app.dismissToast(toast.id)}>
        <X size={16} />
      </button>
    </div>
  {/each}
</div>

<style>
  @layer components {
    .toasts {
      position: fixed;
      left: 50%;
      bottom: calc(var(--status-h) + 64px);
      translate: -50% 0;
      z-index: 50;
      display: grid;
      gap: var(--space-2);
      width: min(460px, calc(100vw - 32px));
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
      color: var(--text);
      background: var(--surface-2);
      border: 2px solid var(--line-strong);
      border-radius: var(--radius-l);
      box-shadow: 0 5px 0 var(--depth);
      pointer-events: auto;
      animation: toast-in var(--dur-pop) var(--ease-spring);
    }

    .toast-icon {
      display: grid;
      flex: none;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: var(--radius-pill);

      .toast-info & {
        color: var(--teal);
        background: color-mix(in oklch, var(--teal), transparent 84%);
      }

      .toast-success & {
        color: var(--mint);
        background: color-mix(in oklch, var(--mint), transparent 84%);
      }

      .toast-error & {
        color: var(--danger-text);
        background: color-mix(in oklch, var(--danger), transparent 82%);
      }
    }

    .toast-text {
      flex: 1 1 auto;
      min-width: 0;
      font-size: 0.9375rem;
      font-weight: 600;
    }

    .toast-action {
      flex: none;
    }

    .toast-close {
      display: grid;
      flex: none;
      place-items: center;
      width: 30px;
      height: 30px;
      color: var(--text-muted);
      border-radius: var(--radius-pill);
      transition:
        color var(--dur-hover) var(--ease-sym),
        background-color var(--dur-hover) var(--ease-sym);

      &:hover {
        color: var(--text);
        background: var(--surface-3);
      }
    }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateY(14px) scale(0.94);
      }
    }
  }
</style>
