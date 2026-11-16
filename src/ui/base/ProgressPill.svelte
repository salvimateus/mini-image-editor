<script lang="ts">
  import { app } from '../../app/state.svelte.ts';
  import { t } from '../../app/i18n/index.ts';
  import KeyText from './KeyText.svelte';

  interface Props {
    /** The text of the pill; by default the label of the tracked work, else a plain "working". */
    label?: string;
  }

  let { label: given }: Props = $props();
  /** `[[Key]]` tokens show as keycaps. */
  const label = $derived(given ?? (app.progressLabel ? t(app.progressLabel) : t('progress.working')));
  const plainLabel = $derived(label.replace(/\[\[([^\]]+)\]\]/g, '$1'));

  const ratio = $derived(app.progress === null ? null : Math.min(1, Math.max(0, app.progress)));
</script>

{#if app.showProgress}
  <div class="progress" role="progressbar" aria-label={plainLabel} aria-valuemin="0" aria-valuemax="100" aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}>
    <span class="progress-label"><KeyText text={label} /></span>
    <span class="progress-track">
      <span class="progress-bar" class:is-indeterminate={ratio === null} style:transform="scaleX({ratio ?? 0.35})"></span>
    </span>
  </div>
{/if}

<style>
  @layer components {
    .progress {
      position: fixed;
      left: 50%;
      top: calc(var(--header-h) + var(--space-3));
      z-index: 40;
      display: grid;
      gap: var(--space-1);
      min-width: 220px;
      padding: var(--space-2) var(--space-4);
      background: var(--surface-2);
      border: 2px solid var(--line-strong);
      border-radius: var(--radius-pill);
      box-shadow: 0 4px 0 var(--depth);
      translate: -50% 0;
      animation: progress-in var(--dur-pop) var(--ease-spring);
      pointer-events: none;
    }

    .progress-label {
      font: 800 0.8125rem/1.2 var(--font-display);
      text-align: center;
    }

    .progress-track {
      display: block;
      height: 6px;
      overflow: hidden;
      background: var(--surface-sunken);
      border-radius: var(--radius-pill);
    }

    .progress-bar {
      display: block;
      height: 100%;
      background: var(--primary);
      border-radius: inherit;
      transform-origin: left center;
      transition: transform var(--dur-pop) var(--ease-out);

      &.is-indeterminate {
        animation: progress-slide 1s var(--ease-sym) infinite alternate;
      }
    }

    @keyframes progress-in {
      from {
        opacity: 0;
        transform: translateY(-8px) scale(0.94);
      }
    }

    @keyframes progress-slide {
      from {
        translate: 0 0;
      }
      to {
        translate: 185% 0;
      }
    }
  }
</style>
