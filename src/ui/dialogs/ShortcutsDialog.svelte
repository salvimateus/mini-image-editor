<script lang="ts">
  import { app } from '../../app/state.svelte.ts';
  import { t, type TextKey } from '../../app/i18n/index.ts';
  import { SHORTCUT_GROUPS, SHORTCUTS, type ShortcutGroup } from '../../app/shortcuts.ts';
  import Dialog from '../base/Dialog.svelte';
  import Keys from '../base/Keys.svelte';
  import KeyText from '../base/KeyText.svelte';

  const GROUP_LABELS: Record<ShortcutGroup, TextKey> = {
    file: 'shortcuts.group.file',
    edit: 'shortcuts.group.edit',
    tools: 'shortcuts.group.tools',
    image: 'shortcuts.group.image',
    adjust: 'shortcuts.group.adjust',
    select: 'shortcuts.group.select',
    layer: 'shortcuts.group.layer',
    view: 'shortcuts.group.view',
  };

  const groups = SHORTCUT_GROUPS.map((group) => ({ group, defs: SHORTCUTS.filter((def) => def.group === group && def.combos.length > 0) })).filter(
    (entry) => entry.defs.length > 0,
  );

  /** Rows that are not actions of SHORTCUTS; `combo` uses the `[[Key+Key]]` tokens of KeyText. */
  interface ExtraRow { combo: string; text: TextKey }

  const EXTRA: readonly { title: TextKey; rows: readonly ExtraRow[] }[] = [
    {
      title: 'shortcuts.group.common',
      rows: [
        { combo: '[[Enter]]', text: 'shortcuts.apply' },
        { combo: '[[Esc]]', text: 'shortcuts.cancel' },
        { combo: '[[ArrowLeft ArrowRight ArrowUp ArrowDown]]', text: 'shortcuts.nudge' },
        { combo: '[[Shift+ArrowLeft ArrowRight ArrowUp ArrowDown]]', text: 'shortcuts.nudgeBig' },
      ],
    },
    {
      title: 'shortcuts.group.mouse',
      rows: [
        { combo: '[[Space+Drag]]', text: 'shortcuts.pan' },
        { combo: '[[Wheel]]', text: 'shortcuts.zoom' },
        { combo: '[[Alt+Click]]', text: 'shortcuts.pick' },
        { combo: '[[RightClick]]', text: 'shortcuts.cloneSource' },
      ],
    },
  ];

  const close = (): void => app.openDialog('none');
</script>

<Dialog open={app.dialog === 'shortcuts'} labelledby="shortcuts-title" onclose={close} wide>
  <div class="dialog-body sheet">
    <h2 id="shortcuts-title" class="dialog-title">{t('shortcuts.title')}</h2>
    <p class="hint">{t('shortcuts.intro')}</p>
    <div class="columns">
      {#each groups as entry (entry.group)}
        <section class="group">
          <h3 class="section-title">{t(GROUP_LABELS[entry.group])}</h3>
          <dl class="rows">
            {#each entry.defs as def (def.id)}
              <div class="row">
                <dt>{t(def.label)}</dt>
                <dd><Keys id={def.id} /></dd>
              </div>
            {/each}
          </dl>
        </section>
      {/each}
      {#each EXTRA as extra (extra.title)}
        <section class="group">
          <h3 class="section-title">{t(extra.title)}</h3>
          <dl class="rows">
            {#each extra.rows as row (row.text)}
              <div class="row">
                <dt>{t(row.text)}</dt>
                <dd><KeyText text={row.combo} /></dd>
              </div>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
    <div class="dialog-actions">
      <button type="button" class="btn btn-primary" data-autofocus onclick={close}>{t('common.close')}</button>
    </div>
  </div>
</Dialog>

<style>
  @layer components {
    .sheet {
      max-height: calc(100dvh - 48px);
      overflow: auto;
    }

    .columns {
      columns: 2 260px;
      column-gap: var(--space-5);
    }

    .group {
      break-inside: avoid;
      display: grid;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
    }

    .rows {
      display: grid;
      gap: 2px;
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: 4px var(--space-2);
      border-radius: var(--radius-s);
      font-size: 0.875rem;
      font-weight: 600;

      &:hover {
        background: var(--surface-2);
      }
    }
  }
</style>
