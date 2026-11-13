<script lang="ts">
  import logoUrl from '../../../app-icon.svg';
  import { t } from '../../app/i18n/index.ts';
  import { openExternal } from '../../app/platform.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app, prefersReducedMotion } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import Burst from '../base/Burst.svelte';
  import Dialog from '../base/Dialog.svelte';

  const AUTHOR = { handle: '@salvimateus', url: 'https://github.com/salvimateus' };
  const FEEL = TUNING.ui.about;
  // Squash and stretch: flat on the press, tall on the rebound, then at rest.
  const SQUASH: Keyframe[] = [
    { transform: 'scale(1, 1)' },
    { transform: 'scale(1.18, 0.8)', offset: 0.2 },
    { transform: 'scale(0.92, 1.1)', offset: 0.5 },
    { transform: 'scale(1.03, 0.97)', offset: 0.78 },
    { transform: 'scale(1, 1)' },
  ];

  let logo: HTMLImageElement | undefined = $state();
  let burst = $state(0);
  let burstCount = $state<number>(FEEL.landBurstCount);

  const open = $derived(app.dialog === 'about');

  // The Burst mounts again with each open; a stale trigger would play it at once.
  $effect(() => {
    if (!open) burst = 0;
  });

  function playBurst(count: number): void {
    burstCount = count;
    burst++;
  }

  /** The entrance pop of the logo ended: it lands with a burst. */
  function land(event: AnimationEvent): void {
    if (event.target !== event.currentTarget) return;
    playBurst(FEEL.landBurstCount);
    // With reduced motion the logo lands at once, together with the open sound of Dialog.
    if (!prefersReducedMotion()) sfx.play('pick');
  }

  function press(): void {
    if (logo && !prefersReducedMotion()) logo.animate(SQUASH, { duration: FEEL.squashMs, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
    playBurst(FEEL.pressBurstCount);
    sfx.play('stamp');
  }

  function openAuthor(event: MouseEvent): void {
    // A plain link would move the desktop window away from the app.
    event.preventDefault();
    sfx.play('tick');
    openExternal(AUTHOR.url).catch((error: unknown) => app.fail(error));
  }

  const close = (): void => app.openDialog('none');
</script>

<Dialog {open} labelledby="about-title" onclose={close}>
  <div
    class="dialog-body about"
    style:--about-logo-delay="{FEEL.logoDelayMs}ms"
    style:--about-pop="{FEEL.logoPopMs}ms"
    style:--about-rise="{FEEL.lineRiseMs}ms"
    style:--about-line-start="{FEEL.lineStartMs}ms"
    style:--about-stagger="{FEEL.staggerMs}ms"
  >
    <div class="logo-wrap">
      <button type="button" class="logo-btn" aria-label={t('about.logoButton')} onclick={press} onanimationend={land}>
        <img bind:this={logo} class="logo-img" src={logoUrl} alt="" width="88" height="88" />
      </button>
      <Burst trigger={burst} count={burstCount} colors={FEEL.burstColors} />
    </div>
    <h2 id="about-title" class="dialog-title about-line" style:--i={0}>{t('app.name')}</h2>
    <p class="about-line tagline" style:--i={1}>{t('about.tagline')}</p>
    <p class="about-line motivation" style:--i={2}>{t('about.motivation')}</p>
    <p class="about-line meta" style:--i={3}>
      <a class="author" href={AUTHOR.url} onclick={openAuthor}>{AUTHOR.handle}</a>
      <span class="license">{t('about.license')}</span>
    </p>
    <div class="dialog-actions about-line actions" style:--i={4}>
      <button type="button" class="btn btn-primary close" data-autofocus onclick={close}>{t('common.close')}</button>
    </div>
  </div>
</Dialog>

<style>
  @layer components {
    .about {
      justify-items: center;
      gap: var(--space-3);
      text-align: center;
    }

    /* Above the text lines, which paint later and each make a stacking context while they animate. */
    .logo-wrap {
      position: relative;
      z-index: 1;
      margin-bottom: var(--space-2);
    }

    .logo-btn {
      display: block;
      padding: 0;
      background: none;
      border: 0;
      border-radius: var(--radius-l);
      cursor: pointer;
      animation: about-pop var(--about-pop) var(--ease-spring) var(--about-logo-delay) backwards;
      transition: transform var(--dur-hover) var(--ease-spring);

      &:is(:hover, :focus-visible) {
        transform: translateY(-2px) rotate(-4deg) scale(1.05);
      }

      &:active {
        transform: translateY(2px) scale(0.95);
        transition-duration: 60ms;
      }
    }

    .logo-img {
      display: block;
      transform-origin: center bottom;
    }

    .about-line {
      animation: about-rise var(--about-rise) var(--ease-out) calc(var(--about-line-start) + var(--i) * var(--about-stagger)) backwards;
    }

    .tagline {
      font-weight: 700;
      color: var(--text);
    }

    .motivation {
      max-width: 36ch;
      color: var(--text-muted);
      line-height: 1.5;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: var(--space-2) var(--space-4);
      font-size: 0.875rem;
    }

    .author {
      display: inline-block;
      padding: 2px var(--space-1);
      font-weight: 800;
      color: var(--text);
      text-decoration: underline 2px var(--primary-edge);
      text-underline-offset: 3px;
      border-radius: var(--radius-s);
      transition: transform var(--dur-hover) var(--ease-spring);

      &:is(:hover, :focus-visible) {
        transform: translateY(-2px);
      }

      &:active {
        transform: translateY(1px) scale(0.97);
        transition-duration: 60ms;
      }
    }

    .license {
      color: var(--text-muted);
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .actions {
      justify-content: center;
    }

    .close:focus-visible:not(:active) {
      transform: translateY(-1px);
    }

    @keyframes about-pop {
      from {
        opacity: 0;
        transform: scale(0.3) rotate(-14deg);
      }
    }

    @keyframes about-rise {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }
  }
</style>
