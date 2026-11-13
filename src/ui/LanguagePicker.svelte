<script lang="ts">
  import Languages from '@lucide/svelte/icons/languages';
  import { t } from '../app/i18n/index.ts';
  import { language, setLanguage, type LanguageId } from '../app/i18n/language.svelte.ts';
  import PickerMenu from './base/PickerMenu.svelte';

  interface Props {
    inBar?: boolean;
  }

  let { inBar = false }: Props = $props();

  /** Each language shows its name in its own language, so a user who cannot read the current one still finds theirs. */
  const ENTRIES: readonly { id: LanguageId; name?: string }[] = [{ id: 'auto' }, { id: 'pt-BR', name: 'Português (Brasil)' }, { id: 'en', name: 'English' }];
</script>

<PickerMenu label={t('language.button')} title={t('language.panel')} entries={ENTRIES} current={language.choice} onpick={setLanguage} {inBar}>
  {#snippet icon()}<Languages size={20} />{/snippet}
  {#snippet row(entry)}
    {#if entry.name}
      <span class="picker-name" lang={entry.id}>{entry.name}</span>
    {:else}
      <span class="stack">
        <span class="picker-name">{t('language.auto')}</span>
        <span class="picker-tag">{t('language.system')}</span>
      </span>
    {/if}
  {/snippet}
</PickerMenu>

<style>
  @layer components {
    /* The tag goes below the name, so the name keeps the full width of the row in each language. */
    .stack {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      min-width: 0;
      padding-block: 4px;

      & .picker-name {
        flex: none;
        max-width: 100%;
      }
    }
  }
</style>
