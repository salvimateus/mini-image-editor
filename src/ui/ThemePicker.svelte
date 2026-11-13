<script lang="ts">
  import Palette from '@lucide/svelte/icons/palette';
  import { t } from '../app/i18n/index.ts';
  import { setTheme, theme, THEMES } from '../app/theme.svelte.ts';
  import PickerMenu from './base/PickerMenu.svelte';

  interface Props {
    inBar?: boolean;
  }

  let { inBar = false }: Props = $props();
</script>

<PickerMenu label={t('theme.button')} title={t('theme.panel')} entries={THEMES} current={theme.current} onpick={setTheme} {inBar}>
  {#snippet icon()}<Palette size={20} />{/snippet}
  {#snippet row(entry)}
    <span class="swatches" aria-hidden="true">
      {#each entry.swatches as color, i (i)}
        <span class="swatch" style:background={color}></span>
      {/each}
    </span>
    <span class="picker-name">{t(entry.label)}</span>
    <span class="picker-tag">{t(entry.kind === 'light' ? 'theme.light' : 'theme.dark')}</span>
  {/snippet}
</PickerMenu>

<style>
  @layer components {
    .swatches {
      display: flex;
    }

    .swatch {
      width: 18px;
      height: 18px;
      border: 2px solid var(--surface-2);
      border-radius: var(--radius-pill);
      box-shadow: 0 0 0 1px var(--line-strong);

      & + & {
        margin-left: -6px;
      }
    }
  }
</style>
