<script lang="ts">
  import { t } from '../../app/i18n/index.ts';
  import { app } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import SliderField from '../base/SliderField.svelte';
  import ToggleSwitch from '../base/ToggleSwitch.svelte';
</script>

<div class="bucket-options">
  <div class="option-slider">
    <SliderField
      id="bucket-tolerance"
      label={t('paint.option.tolerance')}
      value={app.bucket.tolerance}
      min={0}
      max={255}
      step={1}
      reset={TUNING.ui.bucketDefaults.tolerance}
      oninput={(value) => app.setBucket({ tolerance: value })}
      onchange={(value) => app.setBucket({ tolerance: value })}
    />
  </div>
  <ToggleSwitch
    id="bucket-contiguous"
    label={t('paint.option.contiguous')}
    hint={t('paint.option.contiguousHint')}
    checked={app.bucket.contiguous}
    onchange={(checked) => app.setBucket({ contiguous: checked })}
  />
</div>

<style>
  @layer components {
    .bucket-options {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      min-width: 0;
    }

    .option-slider {
      flex: none;
      width: 280px;

      & :global(.slider-field) {
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        column-gap: var(--space-2);
      }
    }
  }
</style>
