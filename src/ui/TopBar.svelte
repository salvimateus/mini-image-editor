<script lang="ts">
  import Download from '@lucide/svelte/icons/download';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import VolumeX from '@lucide/svelte/icons/volume-x';
  import logoUrl from '../../app-icon.svg';
  import { actionEnabled, runAction } from '../app/actions/index.ts';
  import { app } from '../app/state.svelte.ts';
  import { t, type TextKey } from '../app/i18n/index.ts';
  import { keyLabels, type ActionId } from '../app/shortcuts.ts';
  import { tooltip } from './base/tooltip.ts';
  import Menu from './Menu.svelte';

  const MENUS: readonly { id: string; label: TextKey; items: readonly (ActionId | null)[] }[] = [
    { id: 'file', label: 'menu.file', items: ['file.new', 'file.open', null, 'layer.addImage', null, 'file.export', null, 'file.close'] },
    { id: 'edit', label: 'menu.edit', items: ['edit.undo', 'edit.redo'] },
    { id: 'image', label: 'menu.image', items: ['image.canvasSize', 'image.imageSize', null, 'tool.crop'] },
    { id: 'adjust', label: 'menu.adjust', items: ['adjust.hueSaturation', 'adjust.levels', 'adjust.sharpen', 'adjust.vignette'] },
    {
      id: 'layer',
      label: 'menu.layer',
      items: [
        'layer.new',
        'layer.duplicate',
        'layer.delete',
        'layer.mergeDown',
        null,
        'layer.transform',
        null,
        'layer.alignLeft',
        'layer.alignCenterH',
        'layer.alignRight',
        'layer.alignTop',
        'layer.alignCenterV',
        'layer.alignBottom',
      ],
    },
    { id: 'select', label: 'menu.select', items: ['select.all', 'select.none', 'select.invert', null, 'select.erase', 'select.fill'] },
    {
      id: 'view',
      label: 'menu.view',
      items: [
        'view.zoomIn',
        'view.zoomOut',
        'view.fit',
        'view.actual',
        null,
        'view.rulers',
        'view.guides',
        'view.grid',
        'view.snap',
        'view.avatar',
        null,
        'guides.center',
        'guides.thirds',
        'guides.clear',
        null,
        'view.hud',
        'view.mute',
      ],
    },
    { id: 'help', label: 'menu.help', items: ['help.shortcuts'] },
  ];

  let openMenu = $state<string | null>(null);
  let bar: HTMLDivElement;

  const doc = $derived(app.doc);
  const dirty = $derived(doc?.history.dirty ?? false);

  function onWindowPointer(event: PointerEvent): void {
    if (openMenu && !bar.contains(event.target as Node)) openMenu = null;
  }

  function onWindowKey(event: KeyboardEvent): void {
    if (openMenu && event.key === 'Escape') openMenu = null;
  }
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onWindowKey} onblur={() => (openMenu = null)} />

<header class="topbar">
  <img class="logo" src={logoUrl} alt={t('app.logoAlt')} width="28" height="28" />

  <div class="menus" role="menubar" aria-label={t('menu.bar')} bind:this={bar}>
    {#each MENUS as menu (menu.id)}
      <Menu
        id={menu.id}
        label={t(menu.label)}
        items={menu.items}
        open={openMenu === menu.id}
        ontoggle={() => (openMenu = openMenu === menu.id ? null : menu.id)}
        onhover={() => {
          if (openMenu && openMenu !== menu.id) openMenu = menu.id;
        }}
        onclose={() => (openMenu = null)}
      />
    {/each}
  </div>

  <div class="doc">
    {#if doc}
      <span class="doc-name selectable" title={doc.name}>{doc.name}</span>
      {#if dirty}<span class="doc-dirty" role="img" aria-label={t('chrome.dirty')} use:tooltip={{ text: t('chrome.dirty') }}></span>{/if}
    {/if}
  </div>

  <div class="actions">
    <button
      type="button"
      class="icon-btn"
      aria-label={t('action.edit.undo')}
      disabled={!actionEnabled('edit.undo')}
      use:tooltip={{ text: t('action.edit.undo'), keys: keyLabels('edit.undo') }}
      onclick={() => runAction('edit.undo', 'pointer')}
    >
      <Undo2 size={20} />
    </button>
    <button
      type="button"
      class="icon-btn"
      aria-label={t('action.edit.redo')}
      disabled={!actionEnabled('edit.redo')}
      use:tooltip={{ text: t('action.edit.redo'), keys: keyLabels('edit.redo') }}
      onclick={() => runAction('edit.redo', 'pointer')}
    >
      <Redo2 size={20} />
    </button>
    <button
      type="button"
      class="icon-btn"
      aria-label={app.muted ? t('sound.unmute') : t('sound.mute')}
      aria-pressed={app.muted}
      use:tooltip={{ text: app.muted ? t('sound.unmute') : t('sound.mute') }}
      onclick={() => runAction('view.mute', 'pointer')}
    >
      {#if app.muted}<VolumeX size={20} />{:else}<Volume2 size={20} />{/if}
    </button>
    <button
      type="button"
      class="btn btn-primary export"
      disabled={!actionEnabled('file.export')}
      use:tooltip={{ text: t('action.file.export'), keys: keyLabels('file.export') }}
      onclick={() => runAction('file.export', 'pointer')}
    >
      <Download size={18} strokeWidth={2.5} />
      {t('chrome.export')}
    </button>
  </div>
</header>

<style>
  @layer components {
    .topbar {
      display: grid;
      grid-template-columns: auto auto minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--space-2);
      height: var(--header-h);
      padding: 0 var(--space-3);
      background: var(--surface-1);
      border-bottom: 2px solid var(--line);
    }

    .logo {
      filter: drop-shadow(0 2px 0 var(--depth));
    }

    .menus {
      display: flex;
      gap: 2px;
    }

    .doc {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      min-width: 0;
    }

    .doc-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 800;
      color: var(--text-muted);
    }

    .doc-dirty {
      flex: none;
      width: 9px;
      height: 9px;
      background: var(--yellow);
      border-radius: var(--radius-pill);
      box-shadow: 0 0 0 3px color-mix(in oklch, var(--yellow) 18%, transparent);
      animation: dirty-in var(--dur-pop) var(--ease-spring);
    }

    .actions {
      display: flex;
      align-items: center;
      gap: var(--space-1);
    }

    .export {
      min-height: 36px;
      margin-left: var(--space-2);
    }

    @media (max-width: 1180px) {
      .topbar {
        gap: var(--space-1);
        padding: 0 var(--space-2);
      }

      .actions .icon-btn {
        width: 34px;
        height: 34px;
      }

      .export {
        padding: 0 var(--space-3);
        margin-left: var(--space-1);
      }
    }

    @keyframes dirty-in {
      from {
        scale: 0;
      }
    }
  }
</style>
