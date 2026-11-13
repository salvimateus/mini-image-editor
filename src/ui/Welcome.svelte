<script lang="ts">
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import ImageUp from '@lucide/svelte/icons/image-up';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import logoUrl from '../../app-icon.svg';
  import { app, IMAGE_ACCEPT, isImageFile, prefersReducedMotion } from '../app/state.svelte.ts';
  import { t } from '../app/i18n/index.ts';
  import * as sfx from '../app/sfx.ts';
  import { TUNING } from '../app/tuning/index.ts';
  import { keyLabels } from '../app/shortcuts.ts';
  import Burst from './base/Burst.svelte';
  import Keys from './base/Keys.svelte';
  import LanguagePicker from './LanguagePicker.svelte';
  import ThemePicker from './ThemePicker.svelte';
  import { tooltip } from './base/tooltip.ts';

  interface Props {
    /** The image files that the user chose, dropped or pasted. Never empty. */
    onfiles: (files: File[]) => void;
    onnew: () => void;
  }

  let { onfiles, onnew }: Props = $props();

  const BURST_COLORS = ['var(--primary)', 'var(--stage-yellow)', 'var(--stage-teal)', 'var(--stage-pink)', 'var(--text)'];
  const SHAKE: Keyframe[] = [
    { transform: 'translateX(0)' },
    { transform: 'translateX(-12px)' },
    { transform: 'translateX(10px)' },
    { transform: 'translateX(-7px)' },
    { transform: 'translateX(4px)' },
    { transform: 'translateX(0)' },
  ];
  const POP: Keyframe[] = [{ transform: 'scale(1)' }, { transform: 'scale(1.035)' }, { transform: 'scale(0.99)' }, { transform: 'scale(1)' }];

  let input: HTMLInputElement;
  let zone: HTMLDivElement;
  let burst = $state(0);

  function animateZone(frames: Keyframe[], duration: number): void {
    if (!zone || prefersReducedMotion()) return;
    zone.animate(frames, { duration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
  }

  function receive(files: File[]): void {
    const images = files.filter(isImageFile);
    if (images.length === 0) {
      sfx.play('error');
      animateZone(SHAKE, 420);
      app.toast(t('toast.notImage'), 'error');
      return;
    }
    if (images.length < files.length) app.toast(t('toast.skippedFiles', { count: files.length - images.length }), 'info');
    animateZone(POP, 360);
    burst++;
    onfiles(images);
  }

  function onPick(): void {
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (files.length > 0) receive(files);
  }

  function onDrop(event: DragEvent): void {
    // The drop then bubbles to the window guard of App, which ends the drag state.
    event.preventDefault();
    if (app.confirmRequest) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) receive(files);
  }

  function isEditable(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  function onPaste(event: ClipboardEvent): void {
    if (app.confirmRequest || isEditable(event.target)) return;
    const items = Array.from(event.clipboardData?.items ?? []);
    const files = items.filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    event.preventDefault();
    if (files.length === 0) {
      app.refuse(t('toast.nothingToPaste'));
      return;
    }
    receive(files);
  }

  function onNew(): void {
    onnew();
  }
</script>

<svelte:window onpaste={onPaste} />

<section class="welcome" aria-labelledby="welcome-title" ondrop={onDrop}>
  <div class="welcome-theme"><LanguagePicker /><ThemePicker /></div>

  <div class="hero">
    <img class="logo" src={logoUrl} alt={t('app.logoAlt')} width="96" height="96" />
    <h1 id="welcome-title" class="title">{t('welcome.title')}</h1>
    <p class="tagline">{t('welcome.tagline')}</p>
  </div>

  <div class="zone" class:is-dragging={app.dragActive} bind:this={zone}>
    <span class="zone-icon" aria-hidden="true"><ImageUp size={44} strokeWidth={1.75} /></span>
    <h2 class="zone-title">{app.dragActive ? t('welcome.zoneRelease') : t('welcome.zone')}</h2>
    <span class="formats">{t('welcome.formats')}</span>

    <div class="actions">
      <button type="button" class="btn btn-primary btn-big" use:tooltip={{ text: t('action.file.open'), keys: keyLabels('file.open') }} onclick={() => input.click()}>
        <FolderOpen size={22} />
        {t('welcome.open')}
      </button>
      <button type="button" class="btn btn-big" use:tooltip={{ text: t('action.file.new'), keys: keyLabels('file.new') }} onclick={onNew}>
        <FilePlus size={22} />
        {t('welcome.new')}
      </button>
    </div>

    <p class="paste">
      {t('welcome.paste')}
      <Keys keys={['Ctrl', 'V']} hint />
    </p>

    <Burst trigger={burst} count={TUNING.ui.dropBurstCount} colors={BURST_COLORS} />
  </div>

  <input
    bind:this={input}
    id="welcome-file"
    name="welcome-file"
    class="visually-hidden"
    type="file"
    accept={IMAGE_ACCEPT}
    aria-label={t('welcome.inputLabel')}
    tabindex="-1"
    onchange={onPick}
  />

  <p class="privacy">
    <ShieldCheck size={18} />
    {t('welcome.privacy')}
  </p>
</section>

<style>
  @layer components {
    .welcome {
      position: relative;
      display: grid;
      place-content: center;
      justify-items: center;
      gap: var(--space-5);
      height: 100%;
      padding: var(--space-5) var(--space-4);
      overflow: auto;
      background-image: radial-gradient(var(--hairline) 1px, transparent 1.5px);
      background-size: 24px 24px;
      background-position: center;
    }

    .welcome-theme {
      position: absolute;
      top: var(--space-3);
      right: var(--space-3);
      z-index: 2;
      display: flex;
      gap: var(--space-1);
    }

    .hero {
      display: grid;
      justify-items: center;
      gap: var(--space-2);
      text-align: center;
    }

    .logo {
      filter: drop-shadow(0 6px 0 var(--depth));
      animation: logo-bob 3.2s var(--ease-sym) infinite alternate;
    }

    .title {
      font-weight: 900;
      font-size: clamp(2.25rem, 3vw + 1rem, 3.25rem);
      letter-spacing: -0.01em;
      text-shadow: 0 4px 0 var(--depth);
    }

    .tagline {
      color: var(--text-muted);
      font-size: 1.125rem;
      font-weight: 600;
    }

    .zone {
      position: relative;
      display: grid;
      justify-items: center;
      gap: var(--space-3);
      width: min(680px, 100%);
      padding: var(--space-6) var(--space-5);
      text-align: center;
      background:
        repeating-linear-gradient(45deg, transparent 0 14px, var(--stripe) 14px 28px),
        var(--surface-1);
      border: 3px dashed var(--line-strong);
      border-radius: var(--radius-xl);
      box-shadow: 0 6px 0 var(--depth);
      transition:
        border-color var(--dur-hover) var(--ease-sym),
        background-color var(--dur-hover) var(--ease-sym);

      &::after {
        content: '';
        position: absolute;
        inset: -3px;
        border-radius: inherit;
        box-shadow:
          0 0 0 6px var(--primary-fill),
          0 0 48px 8px var(--primary-glow);
        opacity: 0;
        transition: opacity var(--dur-pop) var(--ease-sym);
        pointer-events: none;
      }

      &.is-dragging {
        border-style: solid;
        border-color: var(--primary);

        &::after {
          opacity: 1;
        }
      }
    }

    .zone-icon {
      display: grid;
      place-items: center;
      width: 84px;
      height: 84px;
      color: var(--primary);
      background: var(--surface-sunken);
      border: 2px solid var(--line);
      border-radius: var(--radius-xl);
      transition: transform var(--dur-pop) var(--ease-spring);

      .is-dragging & {
        transform: translateY(-6px) rotate(-6deg) scale(1.08);
      }
    }

    .zone-title {
      font-size: 1.625rem;
    }

    .formats {
      padding: var(--space-1) var(--space-3);
      color: var(--text-muted);
      background: var(--surface-sunken);
      border-radius: var(--radius-pill);
      font-size: 0.8125rem;
      font-weight: 800;
      letter-spacing: 0.04em;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--space-3);
      margin-top: var(--space-2);
    }

    .paste {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--text-muted);
      font-weight: 600;
    }

    .privacy {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--text-faint);
      font-weight: 600;

      & :global(svg) {
        color: var(--mint);
      }
    }

    @media (max-height: 760px) {
      .welcome {
        gap: var(--space-3);
        padding-block: var(--space-3);
      }

      .logo {
        width: 64px;
        height: 64px;
      }

      .title {
        font-size: 2.25rem;
      }

      .zone {
        gap: var(--space-2);
        padding: var(--space-4);
      }

      .zone-icon {
        width: 64px;
        height: 64px;
      }
    }

    @keyframes logo-bob {
      from {
        transform: translateY(0) rotate(0);
      }
      to {
        transform: translateY(-6px) rotate(-2deg);
      }
    }
  }
</style>
