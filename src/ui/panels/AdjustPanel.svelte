<script lang="ts" module>
  /** Identity of an object as a number, so a session key can be a plain string. */
  const serials = new WeakMap<object, number>();
  let lastSerial = 0;

  function serialOf(value: object | null | undefined): number {
    if (!value) return 0;
    let serial = serials.get(value);
    if (serial === undefined) {
      serial = ++lastSerial;
      serials.set(value, serial);
    }
    return serial;
  }
</script>

<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import type { AdjustOp, Histogram, Rect } from '../../core/types.ts';
  import type { EditorDoc, LayerPreview } from '../../app/doc.svelte.ts';
  import { t, type TextKey } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import { sparkColors } from '../stage-renderer.ts';
  import Keys from '../base/Keys.svelte';
  import ToggleSwitch from '../base/ToggleSwitch.svelte';

  interface Props {
    titleId: string;
    title: string;
    /** The history label of Apply. */
    label: TextKey;
    /** Filter mode: the op of the current values; null = identity (no preview, Apply off). */
    op?: AdjustOp | null;
    /** Filter mode: a full-resolution preview region in layer px; null = the whole layer (on the proxy). */
    region?: Rect | null;
    /** Filter mode: the histogram of the source, once per session. */
    onbegin?: (histogram: Histogram) => void;
    canReset: boolean;
    onreset: () => void;
    /** Filter mode: the op is in the document, for a panel that stores its last values. */
    onapplied?: () => void;
    /** Generator mode: the child owns the preview; `apply` returns true when the document changed. */
    generator?: { apply(): Promise<boolean> } | null;
    /** Generator mode only. */
    canApply?: boolean;
    /** Generator mode: a message in place of the controls. */
    blocked?: string | null;
    /** Generator mode: a short line under the title. */
    note?: string | null;
    /** The Preview switch. */
    preview?: boolean;
    children: Snippet<[{ disabled: boolean }]>;
  }

  let {
    titleId,
    title,
    label,
    op = null,
    region = null,
    onbegin,
    canReset,
    onreset,
    onapplied,
    generator = null,
    canApply: generatorCanApply = false,
    blocked: generatorBlocked = null,
    note: generatorNote = null,
    preview = $bindable(true),
    children,
  }: Props = $props();

  type Status = 'blocked' | 'starting' | 'ready' | 'applying' | 'error';

  let status = $state<Status>('starting');
  let restartTick = $state(0);
  let generatorBusy = $state(false);
  let closing = false;
  let panelEl = $state<HTMLElement>();

  // The panel opens with the focus on its first control: arrows change it, Enter applies, Esc cancels.
  // The body can render after the panel: the effect runs again on each status change until a control has the focus.
  let focusedOnce = false;
  $effect(() => {
    void status;
    if (focusedOnce || !panelEl) return;
    // A visible value field first. With none (Sharpen steps), the panel itself: Enter on a focused step button
    // would press it instead of applying, and Tab still reaches every control.
    if (!panelEl.querySelector('.adjust-body')) return;
    const fields = panelEl.querySelectorAll<HTMLElement>('.adjust-body input:not(:disabled)');
    const first = Array.from(fields).find((field) => field.checkVisibility()) ?? panelEl;

    if (!panelEl.contains(document.activeElement)) first.focus({ preventScroll: true });
    focusedOnce = panelEl.contains(document.activeElement);
  });

  // The live session (filter mode). `serial` changes on each start and stop, so late replies of an old session drop.
  let serial = 0;
  let sessionDoc: EditorDoc | null = null;
  let sessionLayer = -1;
  let ownPreview: LayerPreview | null = null;
  let ownTouch = false;
  let pumping = false;
  let again = false;

  const doc = $derived(app.doc);
  const layer = $derived(doc?.active ?? null);
  const filterBlocked = $derived.by((): TextKey | null => {
    if (!doc) return 'adjust.blocked.noDoc';
    if (!layer) return 'adjust.blocked.noLayer';
    if (layer.kind === 'text') return 'adjust.blocked.text';
    if (layer.kind === 'shape') return 'adjust.blocked.shape';
    if (layer.generator) return layer.generator.kind === 'frame' ? 'adjust.blocked.frame' : 'adjust.blocked.generated';
    return null;
  });
  const sessionKey = $derived(
    layer && doc
      ? `${serialOf(doc)}:${layer.id}:${serialOf(layer.image)}:${layer.x},${layer.y}:${serialOf(doc.selection)}:${restartTick}`
      : `none:${filterBlocked}`,
  );

  const blockedText = $derived(generator ? generatorBlocked : filterBlocked ? t(filterBlocked) : null);
  const note = $derived.by(() => {
    if (generator) return generatorNote;
    if (!layer || filterBlocked) return null;
    const parts = [t('adjust.layerNote', { name: layer.name })];
    if (doc?.selection) parts.push(t('adjust.selectionNote'));
    return parts.join(' · ');
  });
  const busy = $derived(generator ? generatorBusy : status === 'applying');
  const canApply = $derived(generator ? generatorCanApply && !generatorBusy : status === 'ready' && op !== null);
  const statusText = $derived.by(() => {
    if (busy) return t('adjust.applying');
    if (generator) return null;
    if (status === 'starting') return t('adjust.loading');
    if (status === 'error') return t('adjust.failed');
    if (status === 'ready' && op === null) return t('adjust.noChange');
    return null;
  });

  function historySig(target: EditorDoc): string {
    const { history } = target;
    return `${history.undoLabel}|${history.redoLabel}|${history.bytes}`;
  }

  function setOwnPreview(target: EditorDoc, next: LayerPreview | null): void {
    if (!next && (!ownPreview || target.preview !== ownPreview)) {
      ownPreview = null;
      return;
    }
    ownTouch = true;
    try {
      target.setPreview(next);
    } finally {
      ownTouch = false;
    }
    ownPreview = next;
  }

  // One session for each layer state: a new layer, new pixels, a new position or a new selection start it again.
  $effect(() => {
    if (generator) return;
    void sessionKey;
    // Only the key starts a session: the reads below (history, selection, preview) must not.
    return untrack(startSession);
  });

  function startSession(): (() => void) | undefined {
    const target = doc;
    const source = layer;
    if (!target || !source || source.kind !== 'raster' || source.generator || filterBlocked) {
      status = 'blocked';
      return undefined;
    }
    const token = ++serial;
    sessionDoc = target;
    sessionLayer = source.id;
    ownPreview = null;
    status = 'starting';
    const startSig = historySig(target);
    const off = target.onChange((change) => {
      if (ownTouch || closing || token !== serial) return;
      if (change && change.layerId !== source.id) return;
      if (!change && historySig(target) === startSig) return;
      restartTick += 1;
    });
    app.engine.adjustBegin(source.image, target.selection, { x: source.x, y: source.y }).then(
      (histogram) => {
        if (token !== serial) return;
        onbegin?.(histogram);
        status = 'ready';
      },
      (error: unknown) => {
        if (token !== serial) return;
        status = 'error';
        app.fail(error);
      },
    );
    return () => {
      off();
      serial += 1;
      setOwnPreview(target, null);
      sessionDoc = null;
      sessionLayer = -1;
      app.engine.adjustEnd().catch(() => {});
    };
  }

  // Each change of the values, the region or the switch asks for a new preview; one request runs at a time.
  $effect(() => {
    if (generator) return;
    void op;
    void region;
    void preview;
    if (status !== 'ready') return;
    untrack(() => void pump());
  });

  async function pump(): Promise<void> {
    if (pumping) {
      again = true;
      return;
    }
    pumping = true;
    const token = serial;
    try {
      do {
        again = false;
        const target = sessionDoc;
        if (token !== serial || status !== 'ready' || !target) return;
        const currentOp = op;
        if (!currentOp || !preview) {
          setOwnPreview(target, null);
          continue;
        }
        const result = await app.engine.adjustPreview(currentOp, region ?? null);
        if (token !== serial || status !== 'ready' || closing) return;
        if (!result) continue;
        setOwnPreview(target, { layerId: sessionLayer, image: result.image, rect: result.rect, scale: result.scale });
      } while (again);
    } catch (error) {
      if (token === serial) app.fail(error);
    } finally {
      pumping = false;
      if (again && token !== serial) again = false;
      else if (again) void pump();
    }
  }

  function celebrate(target: EditorDoc): void {
    sfx.play('apply');
    const stage = app.stage;
    if (!stage) return;
    const at = stage.docToScreen(target.width / 2, target.height / 2);
    const burst = TUNING.adjust.applyBurst;
    stage.particles.burst(at.x, at.y, { ...burst, colors: sparkColors() });
    stage.invalidateFx();
  }

  function close(): void {
    closing = true;
    app.openPanel('none');
  }

  async function apply(): Promise<void> {
    if (!canApply) return;
    if (generator) {
      generatorBusy = true;
      try {
        const done = await generator.apply();
        if (done && app.doc) celebrate(app.doc);
        if (done) close();
        else sfx.play('cancel');
      } catch (error) {
        app.fail(error);
      } finally {
        generatorBusy = false;
      }
      return;
    }
    const target = sessionDoc;
    const currentOp = op;
    if (!target || !currentOp) return;
    const token = serial;
    const id = sessionLayer;
    status = 'applying';
    try {
      const image = await app.track(app.engine.adjustCommit(currentOp));
      if (token !== serial || app.doc !== target || !target.layer(id)) return;
      closing = true;
      target.replaceImage(id, image, null, label);
      onapplied?.();
      celebrate(target);
      close();
    } catch (error) {
      if (token !== serial) return;
      status = 'ready';
      app.fail(error);
    }
  }

  function cancel(): void {
    sfx.play('cancel');
    close();
  }

  function reset(): void {
    if (!canReset) return;
    sfx.play('tick');
    onreset();
  }

  function retry(): void {
    sfx.play('tick');
    restartTick += 1;
  }

  function onWindowKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || closing) return;
    if (app.dialog !== 'none' || app.confirmRequest) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if (event.key === 'Enter' && !event.repeat && !event.ctrlKey && !event.altKey) {
      // A button that the keyboard focused takes its own Enter; one focused by a mouse click does not.
      if (target instanceof HTMLElement && /^(BUTTON|SUMMARY|A)$/.test(target.tagName) && target.matches(':focus-visible')) return;
      if (!canApply) return;
      event.preventDefault();
      void apply();
    }
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<section bind:this={panelEl} class="side-panel adjust" tabindex="-1" aria-labelledby={titleId} aria-busy={busy || (!generator && status === 'starting')}>
  <header class="adjust-head">
    <h2 id={titleId} class="section-title">{title}</h2>
    {#if note && !blockedText}<p class="adjust-note">{note}</p>{/if}
  </header>

  {#if blockedText}
    <p class="adjust-blocked" role="status">{blockedText}</p>
  {:else}
    <div class="adjust-body" inert={busy}>
      {@render children({ disabled: busy })}
    </div>

    <div class="adjust-tools">
      <ToggleSwitch id="{titleId}-preview" label={t('adjust.preview')} hint={t('adjust.previewHint')} checked={preview} disabled={busy} onchange={(on) => (preview = on)} />
      <button type="button" class="btn btn-small btn-quiet" title={t('adjust.resetHint')} disabled={!canReset || busy} onclick={reset}>
        {t('adjust.reset')}
      </button>
    </div>
  {/if}

  {#if statusText}
    <p class="adjust-status" role="status">
      <span class:is-busy={busy || status === 'starting'}>{statusText}</span>
      {#if status === 'error' && !generator}
        <button type="button" class="btn btn-small btn-quiet" onclick={retry}>{t('adjust.retry')}</button>
      {/if}
    </p>
  {/if}

  <div class="adjust-actions">
    <button type="button" class="btn btn-quiet adjust-action" disabled={busy} onclick={cancel}>
      {t('adjust.cancel')}
      <Keys keys={['Esc']} />
    </button>
    {#if !blockedText}
      <button type="button" class="btn btn-primary adjust-action" disabled={!canApply} onclick={() => void apply()}>
        {t('adjust.apply')}
        <Keys keys={['Enter']} />
      </button>
    {/if}
  </div>
</section>

<style>
  @layer components {
    .adjust {
      contain: layout style;
    }

    .adjust-head {
      display: grid;
      gap: 2px;
      /* Room for the close button of the right column. */
      padding-right: 40px;
      min-height: 32px;
      align-content: center;
    }

    .adjust-note {
      overflow: hidden;
      color: var(--text-faint);
      font-size: 0.75rem;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .adjust-blocked {
      padding: var(--space-3);
      color: var(--text-muted);
      background: var(--surface-sunken);
      border: 2px dashed var(--line);
      border-radius: var(--radius-m);
      font-size: 0.875rem;
      font-weight: 700;
      line-height: 1.4;
    }

    .adjust-body {
      display: grid;
      gap: var(--space-3);
      min-width: 0;
    }

    .adjust-tools {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      padding-top: var(--space-2);
      border-top: 2px solid var(--line);
    }

    .adjust-status {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      min-height: 1.25rem;
      color: var(--text-faint);
      font-size: 0.8125rem;
      font-weight: 700;
    }

    .is-busy {
      animation: adjust-pulse 900ms var(--ease-sym) infinite alternate;
    }

    .adjust-actions {
      display: grid;
      grid-auto-columns: minmax(0, 1fr);
      grid-auto-flow: column;
      gap: var(--space-2);
    }

    .adjust-action {
      padding: 0 var(--space-2);
      font-size: 0.875rem;
    }

    @keyframes adjust-pulse {
      to {
        opacity: 0.45;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .is-busy {
        animation: none;
      }
    }
  }
</style>
