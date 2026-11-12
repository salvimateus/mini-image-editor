<script lang="ts">
  import Crosshair from '@lucide/svelte/icons/crosshair';
  import X from '@lucide/svelte/icons/x';
  import { t } from '../../app/i18n/index.ts';
  import { clearCloneSource, watchCloneSource } from '../../app/tools/clone.ts';
  import { tooltip } from '../base/tooltip.ts';
  import PaintOptions from './PaintOptions.svelte';

  let hasSource = $state(false);

  $effect(() => watchCloneSource((value) => (hasSource = value)));
</script>

<div class="clone-options">
  <PaintOptions tool="clone" />
  <span class="source" class:is-set={hasSource} use:tooltip={{ text: t('paint.option.sourceHelp'), keys: ['Alt', 'Click'] }}>
    <Crosshair size={14} />
    {hasSource ? t('paint.option.sourceSet') : t('paint.option.sourceMissing')}
  </span>
  {#if hasSource}
    <button type="button" class="icon-btn clear" aria-label={t('paint.option.clearSource')} use:tooltip={{ text: t('paint.option.clearSource') }} onclick={clearCloneSource}>
      <X size={14} />
    </button>
  {/if}
</div>

<style>
  @layer components {
    .clone-options {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;
    }

    .source {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: var(--space-1);
      height: 28px;
      padding: 0 var(--space-3);
      color: var(--text-faint);
      background: var(--surface-sunken);
      border: 2px dashed var(--line);
      border-radius: var(--radius-pill);
      font: 800 0.8125rem/1 var(--font-display);
      white-space: nowrap;

      &.is-set {
        color: var(--teal);
        border-style: solid;
        border-color: color-mix(in oklch, var(--teal), transparent 50%);
      }
    }

    .clear {
      width: 28px;
      height: 28px;
      border-radius: var(--radius-s);
    }
  }
</style>
