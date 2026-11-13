<script lang="ts">
  import { SKETCH_PRESET_IDS, type SketchPresetId } from '../../core/params/paint.ts';
  import { t, type TextKey } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app } from '../../app/state.svelte.ts';
  import { tooltip } from '../base/tooltip.ts';
  import PaintOptions from './PaintOptions.svelte';
  import { PREVIEW_H, PREVIEW_W, sketchPreview } from './sketch-preview.ts';

  const PRESET_META: Record<SketchPresetId, { label: TextKey; tip: TextKey }> = {
    '2b': { label: 'paint.preset.2b', tip: 'paint.preset.2bTip' },
    '6b': { label: 'paint.preset.6b', tip: 'paint.preset.6bTip' },
    charcoal: { label: 'paint.preset.charcoal', tip: 'paint.preset.charcoalTip' },
    colored: { label: 'paint.preset.colored', tip: 'paint.preset.coloredTip' },
    chalk: { label: 'paint.preset.chalk', tip: 'paint.preset.chalkTip' },
    crayon: { label: 'paint.preset.crayon', tip: 'paint.preset.crayonTip' },
  };

  const preset = $derived(app.brush.sketch.preset);

  function setPreset(id: SketchPresetId): void {
    if (id === preset) return;
    sfx.play('tick');
    app.setBrush('sketch', { preset: id });
    // The cursor ring takes the size of the new preset.
    app.stage?.invalidateFx();
  }
</script>

<div class="sketch-options">
  <div class="sketch-presets" role="group" aria-label={t('paint.option.preset')}>
    {#each SKETCH_PRESET_IDS as id (id)}
      {@const meta = PRESET_META[id]}
      <button type="button" class="preset" aria-pressed={preset === id} use:tooltip={{ text: t(meta.tip) }} onclick={() => setPreset(id)}>
        <span
          class="preset-stroke"
          style:width="{PREVIEW_W}px"
          style:height="{PREVIEW_H}px"
          style:mask-image="url({sketchPreview(id)})"
          aria-hidden="true"
        ></span>
        <span class="preset-label">{t(meta.label)}</span>
      </button>
    {/each}
  </div>
  <PaintOptions tool="sketch" />
</div>

<style>
  @layer components {
    .sketch-options {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;
    }

    .sketch-presets {
      display: flex;
      flex: none;
      gap: 2px;
      padding: 2px;
      background: var(--surface-sunken);
      border: 2px solid var(--line);
      border-radius: var(--radius-m);
    }

    .preset {
      display: grid;
      justify-items: center;
      align-content: center;
      gap: 1px;
      min-width: 72px;
      height: 34px;
      /* 8px or more on each side of the longest labels. */
      padding: 0 var(--space-2);
      color: var(--text-muted);
      background: var(--surface-2);
      border-radius: var(--radius-s);
      transition: transform var(--dur-hover) var(--ease-spring);

      &:hover:not([aria-pressed='true']) {
        color: var(--text);
        background: var(--surface-3);

        & .preset-stroke {
          opacity: 1;
        }
      }

      &:focus-visible {
        outline: 3px solid var(--focus);
        outline-offset: 2px;
      }

      &:active {
        transform: translateY(1px) scale(0.97);
        transition-duration: 60ms;
      }

      &[aria-pressed='true'] {
        color: var(--on-primary);
        background: var(--primary);

        & .preset-stroke {
          opacity: 1;
        }
      }
    }

    .preset-stroke {
      display: block;
      /* The preview may enter the side padding, so a short label keeps the button at its 72px minimum. */
      margin-inline: -2px;
      background: currentColor;
      opacity: 0.8;
      mask-repeat: no-repeat;
      mask-size: 100% 100%;
      transition: opacity var(--dur-hover) var(--ease-sym);
    }

    .preset-label {
      font: 800 0.6875rem/1 var(--font-display);
      white-space: nowrap;
    }

    @media (prefers-reduced-motion: reduce) {
      .preset:active {
        transform: none;
      }
    }
  }
</style>
