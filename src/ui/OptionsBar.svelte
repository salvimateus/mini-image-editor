<script lang="ts">
  import { app } from '../app/state.svelte.ts';
  import { t } from '../app/i18n/index.ts';
  import { TOOL_OPTIONS } from './options/index.ts';
  import { TOOL_META } from './ToolRail.svelte';

  const meta = $derived(TOOL_META[app.tool]);
  const Options = $derived(TOOL_OPTIONS[app.tool]);
</script>

<div class="options" role="toolbar" aria-label={t('chrome.options')}>
  {#key app.tool}
    {@const Icon = meta.icon}
    <span class="options-tool">
      <Icon size={18} strokeWidth={2.25} />
      {t(meta.label)}
    </span>
  {/key}
  <div class="options-body">
    {#if Options}
      <Options />
    {:else}
      <span class="hint">{t('chrome.noOptions')}</span>
    {/if}
  </div>
</div>

<style>
  @layer components {
    .options {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;
      height: 44px;
      padding: 0 var(--space-3);
      background: var(--surface-1);
      border-bottom: 2px solid var(--line);
    }

    .options-tool {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: var(--space-2);
      padding-right: var(--space-3);
      border-right: 2px solid var(--line);
      color: var(--primary);
      font: 800 0.9375rem/1 var(--font-display);
      animation: options-in var(--dur-pop) var(--ease-out);
    }

    .options-body {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      min-width: 0;
      overflow-x: auto;
      overflow-y: hidden;

      /* Options never squeeze each other: a long row scrolls instead. */
      & > :global(*) {
        flex: none;
      }
    }

    @keyframes options-in {
      from {
        opacity: 0;
        transform: translateX(-6px);
      }
    }
  }
</style>
