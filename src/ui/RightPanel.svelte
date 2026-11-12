<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import { app } from '../app/state.svelte.ts';
  import { t } from '../app/i18n/index.ts';
  import * as sfx from '../app/sfx.ts';
  import ColorPanel from './panels/ColorPanel.svelte';
  import { PANELS } from './panels/index.ts';
  import LayersPanel from './panels/LayersPanel.svelte';

  const Feature = $derived(app.panel === 'none' ? null : PANELS[app.panel]);

  function close(): void {
    sfx.play('tick');
    app.openPanel('none');
  }
</script>

<aside class="side" aria-label={t('chrome.panels')}>
  {#if Feature}
    {#key app.panel}
      <div class="feature">
        <button type="button" class="icon-btn feature-close" aria-label={t('chrome.panel.close')} title={t('chrome.panel.close')} onclick={close}>
          <X size={18} />
        </button>
        <Feature />
      </div>
    {/key}
  {/if}
  <div class="color">
    <ColorPanel />
  </div>
  <div class="layers">
    <LayersPanel />
  </div>
</aside>

<style>
  @layer components {
    .side {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      min-height: 0;
      padding: var(--space-2);
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-gutter: stable;
      background: var(--surface-1);
      border-left: 2px solid var(--line);
    }

    /* A short window scrolls the column: no panel shrinks below its content. */
    .color {
      flex: none;
    }

    .feature {
      position: relative;
      flex: none;
      animation: feature-in var(--dur-modal) var(--ease-spring);
    }

    .feature-close {
      position: absolute;
      top: var(--space-2);
      right: var(--space-2);
      z-index: 1;
      width: 32px;
      height: 32px;
    }

    .layers {
      display: flex;
      flex: 1 0 auto;
      flex-direction: column;
      min-height: 160px;
    }

    @keyframes feature-in {
      from {
        opacity: 0;
        transform: translateX(16px);
      }
    }
  }
</style>
