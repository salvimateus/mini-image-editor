<script lang="ts">
  import { formatBytes, t } from '../../app/i18n/index.ts';

  interface Props {
    /** Size of the file with no optimization, or null while it is calculated. */
    before: number | null;
    /** Size of the optimized file, or null while it is calculated. */
    after: number | null;
    optimize: boolean;
    /** A larger style for a total line. */
    strong?: boolean;
  }

  let { before, after, optimize, strong = false }: Props = $props();

  /** The saving in whole percent; the optimized file is never larger, and an equal size is 0%. */
  const pct = $derived(before !== null && after !== null && before > 0 && after < before ? Math.round(((before - after) / before) * 100) : 0);
  const pending = $derived(before === null || (optimize && after === null));
  const label = $derived.by(() => {
    if (before === null || (optimize && after === null)) return t('size.pending');
    if (!optimize) return t('size.plain', { size: formatBytes(before) });
    return t('size.delta', { before: formatBytes(before), after: formatBytes(after ?? before), pct });
  });
</script>

<span class="size" class:is-strong={strong}>
  <span class="visually-hidden">{label}</span>
  {#if pending}
    <span class="busy" aria-hidden="true"><span class="dot"></span>{t('size.pending')}</span>
  {:else if !optimize}
    <span aria-hidden="true">{formatBytes(before ?? 0)}</span>
  {:else}
    <span class="before" aria-hidden="true">{formatBytes(before ?? 0)}</span>
    <span class="arrow" aria-hidden="true">→</span>
    <span aria-hidden="true">{formatBytes(after ?? before ?? 0)}</span>
    {#key pct}
      <span class="badge" class:is-gain={pct > 0} aria-hidden="true">{pct > 0 ? `−${pct}%` : '0%'}</span>
    {/key}
  {/if}
</span>

<style>
  @layer components {
    .size {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 2px 6px;
      font-family: var(--font-body);
      font-size: 0.8125rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;

      &.is-strong {
        font-size: 0.9375rem;
        font-weight: 800;
      }
    }

    .before {
      color: var(--text-muted);
    }

    .arrow {
      color: var(--text-faint);
    }

    .badge {
      padding: 1px 8px;
      color: var(--text-muted);
      background: var(--surface-3);
      border-radius: var(--radius-pill);
      font-weight: 800;
      font-size: 0.75rem;

      &.is-gain {
        color: var(--on-primary);
        background: var(--mint);
        animation: badge-pop var(--dur-modal) var(--ease-spring);
      }
    }

    .busy {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--text-muted);
    }

    .dot {
      width: 8px;
      height: 8px;
      background: var(--teal);
      border-radius: var(--radius-pill);
      animation: busy-blink 0.8s var(--ease-sym) infinite alternate;
    }

    @keyframes badge-pop {
      from {
        transform: scale(0.6);
        opacity: 0;
      }
    }

    @keyframes busy-blink {
      from {
        opacity: 0.25;
      }
    }
  }
</style>
