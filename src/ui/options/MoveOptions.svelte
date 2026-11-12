<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import Scaling from '@lucide/svelte/icons/scaling';
  import X from '@lucide/svelte/icons/x';
  import { actionEnabled, runAction } from '../../app/actions/index.ts';
  import { t } from '../../app/i18n/index.ts';
  import KeyText from '../base/KeyText.svelte';
  import { keyLabels } from '../../app/shortcuts.ts';
  import { app } from '../../app/state.svelte.ts';
  import { applyTransform, cancelTransform, transformOn } from '../../app/tools/move.ts';
  import Keys from '../base/Keys.svelte';
  import { tooltip } from '../base/tooltip.ts';

  const layer = $derived(app.doc?.active ?? null);
</script>

<span class="move-layer">
  <span class="move-label">{t('select.move.layer')}</span>
  <strong class="move-name">{layer?.name ?? t('select.move.noLayer')}</strong>
</span>

{#if $transformOn}
  <span class="hint move-tip"><KeyText text={t('select.move.transforming')} /></span>
  <button type="button" class="btn btn-small btn-primary" onclick={() => void applyTransform()}>
    <Check size={16} strokeWidth={2.5} />
    {t('select.move.apply')}
    <Keys keys={['Enter']} />
  </button>
  <button type="button" class="btn btn-small btn-quiet" onclick={() => cancelTransform()}>
    <X size={16} strokeWidth={2.5} />
    {t('select.move.cancel')}
    <Keys keys={['Esc']} />
  </button>
{:else}
  <button
    type="button"
    class="btn btn-small"
    disabled={!layer || !actionEnabled('layer.transform')}
    use:tooltip={{ text: t('action.layer.transform'), keys: keyLabels('layer.transform') }}
    onclick={() => runAction('layer.transform', 'pointer')}
  >
    <Scaling size={16} strokeWidth={2.25} />
    {t('select.move.transform')}
    <Keys id="layer.transform" />
  </button>
  <span class="hint move-nudge">
    <Keys keys={['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']} />
    {t('select.move.nudge')}
    <span class="move-plus">
      <Keys keys={['Shift']} />
      {t('select.move.nudgeBig')}
    </span>
  </span>
{/if}

<style>
  @layer components {
    .move-layer {
      display: inline-flex;
      align-items: baseline;
      gap: var(--space-2);
      min-width: 0;
      max-width: 16rem;
    }

    .move-label {
      flex: none;
      color: var(--text-muted);
      font-size: 0.8125rem;
      font-weight: 700;
    }

    .move-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 800;
    }

    .move-tip,
    .move-nudge {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      white-space: nowrap;
    }

    .move-plus {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding-left: var(--space-2);
      border-left: 2px solid var(--line);
    }
  }
</style>
