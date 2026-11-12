<script lang="ts">
  import Link2 from '@lucide/svelte/icons/link-2';
  import Link2Off from '@lucide/svelte/icons/link-2-off';
  import { untrack } from 'svelte';
  import type { Point, RasterImage, ResampleMethod, TextSpec } from '../../core/types.ts';
  import { stageSizeProblem } from '../../app/actions/geometry.ts';
  import type { EditorDoc } from '../../app/doc.svelte.ts';
  import { prepareGenerators } from '../../app/generators.ts';
  import { formatBytes, locale, parseDecimal, t, type TextKey } from '../../app/i18n/index.ts';
  import * as sfx from '../../app/sfx.ts';
  import { app } from '../../app/state.svelte.ts';
  import { placeText, renderTextLayer, scaleTextSpec, textAnchor } from '../../app/text-render.ts';
  import { flashStageOutline } from '../../app/tools/crop.ts';
  import Dialog from '../base/Dialog.svelte';
  import { tooltip } from '../base/tooltip.ts';

  type Unit = 'px' | 'pct';

  const METHODS: readonly { id: ResampleMethod; label: TextKey; hint: TextKey }[] = [
    { id: 'auto', label: 'geometry.method.auto', hint: 'geometry.method.autoHint' },
    { id: 'smooth', label: 'geometry.method.smooth', hint: 'geometry.method.smoothHint' },
    { id: 'sharp', label: 'geometry.method.sharp', hint: 'geometry.method.sharpHint' },
    { id: 'nearest', label: 'geometry.method.nearest', hint: 'geometry.method.nearestHint' },
  ];
  /** Longest-side presets; 0 = the original size. */
  const PRESETS: readonly number[] = [0, 512, 1024, 1080, 1920, 2048, 4096];
  const LABEL = 'geometry.history.imageSize' satisfies TextKey;

  const amount = new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false });

  const open = $derived(app.dialog === 'image-size');
  let unit = $state<Unit>('px');
  let widthText = $state('');
  let heightText = $state('');
  let chained = $state(true);
  let method = $state<ResampleMethod>('auto');

  const oldW = $derived(app.doc?.width ?? 1);
  const oldH = $derived(app.doc?.height ?? 1);

  // Each opening starts from the current size, in px, with the chain on.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      unit = 'px';
      chained = true;
      widthText = String(oldW);
      heightText = String(oldH);
    });
  });

  function sideOf(text: string, old: number): number | null {
    const value = parseDecimal(text);
    if (value === null) return null;
    return Math.round(unit === 'px' ? value : (old * value) / 100);
  }

  function textOf(side: number, old: number, inUnit: Unit): string {
    return inUnit === 'px' ? String(side) : amount.format((side / old) * 100);
  }

  const width = $derived(sideOf(widthText, oldW));
  const height = $derived(sideOf(heightText, oldH));
  const problem = $derived(width === null || height === null ? t('geometry.invalid.number') : stageSizeProblem(width, height));
  const longest = $derived(width !== null && height !== null ? Math.max(width, height) : null);
  const methodHint = $derived(METHODS.find((entry) => entry.id === method)?.hint ?? 'geometry.method.autoHint');

  const weightNow = $derived(app.weight.pending ? t('size.pending') : app.weight.bytes !== null ? formatBytes(app.weight.bytes) : '—');
  const weightAfter = $derived.by(() => {
    if (app.weight.pending || app.weight.bytes === null || width === null || height === null || problem) return '—';
    return `≈ ${formatBytes(Math.round((app.weight.bytes * width * height) / (oldW * oldH)))}`;
  });

  function cancel(): void {
    sfx.play('cancel');
    close();
  }

  function close(): void {
    app.openDialog('none');
  }

  function onWidthInput(): void {
    if (!chained || width === null) return;
    heightText = unit === 'pct' ? widthText : String(Math.max(1, Math.round((width * oldH) / oldW)));
  }

  function onHeightInput(): void {
    if (!chained || height === null) return;
    widthText = unit === 'pct' ? heightText : String(Math.max(1, Math.round((height * oldW) / oldH)));
  }

  function pickUnit(next: Unit): void {
    if (next === unit) return;
    sfx.play('tick');
    const w = width ?? oldW;
    const h = height ?? oldH;
    widthText = textOf(w, oldW, next);
    heightText = textOf(h, oldH, next);
    unit = next;
  }

  function toggleChain(): void {
    chained = !chained;
    sfx.play('tick');
    if (chained) onWidthInput();
  }

  /** The size of a longest-side preset, with the proportions of the image. */
  function presetSize(side: number): [number, number] {
    const scale = side === 0 ? 1 : side / Math.max(oldW, oldH);
    return [Math.max(1, Math.round(oldW * scale)), Math.max(1, Math.round(oldH * scale))];
  }

  function pickPreset(side: number): void {
    sfx.play('tick');
    const [w, h] = presetSize(side);
    unit = 'px';
    widthText = String(w);
    heightText = String(h);
  }

  function presetActive(side: number): boolean {
    if (width === null || height === null) return false;
    if (side === 0) return width === oldW && height === oldH;
    return longest === side && Math.abs(width / height - oldW / oldH) < 0.01;
  }

  interface Plan {
    raster: { id: number; image: RasterImage; at: Point }[];
    text: { id: number; spec: TextSpec; image: RasterImage; at: Point }[];
    putGenerated: () => void;
    /** The images that the plan started from, by layer id. */
    sources: Map<number, RasterImage>;
  }

  /** Every new image, made before the one undo step that puts them in. */
  async function makePlan(doc: EditorDoc, w: number, h: number, resample: ResampleMethod): Promise<Plan> {
    const sx = w / doc.width;
    const sy = h / doc.height;
    const textFactor = Math.sqrt(sx * sy);
    const plan: Plan = { raster: [], text: [], putGenerated: () => {}, sources: new Map() };
    for (const layer of doc.layers) plan.sources.set(layer.id, layer.image);
    for (const layer of [...doc.layers]) {
      const at = { x: Math.round(layer.x * sx), y: Math.round(layer.y * sy) };
      if (layer.kind === 'text') {
        // The text box anchor scales with the stage; the padding of the outline and the shadow is measured again.
        const anchor = textAnchor(layer);
        const spec = scaleTextSpec(layer.spec, textFactor);
        const image = await renderTextLayer(spec);
        plan.text.push({ id: layer.id, spec, image, at: placeText({ x: anchor.x * sx, y: anchor.y * sy }, image, spec) });
      } else if (!layer.generator) {
        const lw = Math.max(1, Math.round(layer.image.width * sx));
        const lh = Math.max(1, Math.round(layer.image.height * sy));
        const image = lw === layer.image.width && lh === layer.image.height ? layer.image : await app.engine.resize(layer.image, lw, lh, resample);
        plan.raster.push({ id: layer.id, image, at });
      }
    }
    plan.putGenerated = await prepareGenerators(doc, w, h);
    return plan;
  }

  /** True when a layer was added, removed or painted while the plan was made. */
  function stale(doc: EditorDoc, plan: Plan): boolean {
    if (doc.layers.length !== plan.sources.size) return true;
    return doc.layers.some((layer) => plan.sources.get(layer.id) !== layer.image);
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const doc = app.doc;
    if (!doc || width === null || height === null || problem) {
      sfx.play('error');
      return;
    }
    const w = width;
    const h = height;
    const resample = method;
    close();
    if (w === doc.width && h === doc.height) {
      sfx.play('tick');
      return;
    }
    try {
      const plan = await app.track(makePlan(doc, w, h, resample));
      if (app.doc !== doc) return;
      if (stale(doc, plan)) {
        sfx.play('error');
        app.toast(t('geometry.image.changed'), 'error');
        return;
      }
      const sx = w / doc.width;
      const sy = h / doc.height;
      doc.batch(LABEL, () => {
        for (const job of plan.raster) doc.replaceImage(job.id, job.image, job.at, LABEL);
        for (const job of plan.text) {
          doc.setTextSpec(job.id, job.spec, job.image);
          doc.setLayerProps(job.id, job.at);
        }
        doc.setGuides(
          doc.guides.map((guide) => ({ ...guide, pos: Math.round(guide.pos * (guide.axis === 'x' ? sx : sy) * 2) / 2 })),
          LABEL,
        );
        doc.setSelection(null, LABEL);
        doc.setStage({ x: 0, y: 0, w, h }, null, LABEL);
        plan.putGenerated();
      });
      sfx.play('resize');
      flashStageOutline();
    } catch (error) {
      app.fail(error);
    }
  }
</script>

<Dialog {open} labelledby="image-size-title" onclose={close}>
  <form class="dialog-body" onsubmit={submit}>
    <h2 id="image-size-title" class="dialog-title">{t('geometry.image.title')}</h2>
    <p class="hint">{t('geometry.current', { w: oldW, h: oldH })}</p>

    <fieldset class="group">
      <legend class="field-label">{t('geometry.image.presets')}</legend>
      <div class="presets">
        {#each PRESETS as side (side)}
          <button type="button" class="preset" aria-pressed={presetActive(side)} disabled={side !== 0 && stageSizeProblem(...presetSize(side)) !== null} onclick={() => pickPreset(side)}>
            {side === 0 ? t('geometry.image.original') : side}
          </button>
        {/each}
      </div>
    </fieldset>

    <div class="row">
      <div class="segmented unit" role="group" aria-label={t('geometry.unit')}>
        <button type="button" aria-pressed={unit === 'px'} onclick={() => pickUnit('px')}>px</button>
        <button type="button" aria-pressed={unit === 'pct'} onclick={() => pickUnit('pct')}>%</button>
      </div>
    </div>

    <div class="sides">
      <label class="field">
        <span class="field-label">{t('geometry.width')} ({unit === 'px' ? 'px' : '%'})</span>
        <input class="number-input" name="image-width" data-autofocus inputmode="decimal" autocomplete="off" bind:value={widthText} oninput={onWidthInput} aria-invalid={problem !== null} />
      </label>
      <button
        type="button"
        class="icon-btn chain"
        aria-pressed={chained}
        aria-label={chained ? t('geometry.image.unchain') : t('geometry.image.chain')}
        use:tooltip={{ text: chained ? t('geometry.image.unchain') : t('geometry.image.chain') }}
        onclick={toggleChain}
      >
        {#if chained}<Link2 size={18} strokeWidth={2.5} />{:else}<Link2Off size={18} strokeWidth={2.5} />{/if}
      </button>
      <label class="field">
        <span class="field-label">{t('geometry.height')} ({unit === 'px' ? 'px' : '%'})</span>
        <input class="number-input" name="image-height" inputmode="decimal" autocomplete="off" bind:value={heightText} oninput={onHeightInput} aria-invalid={problem !== null} />
      </label>
    </div>

    {#if problem}
      <p class="hint invalid" role="alert">{problem}</p>
    {:else if width !== null && height !== null}
      <p class="hint">{t('geometry.image.result', { w: width, h: height })}</p>
    {/if}

    <fieldset class="group">
      <legend class="field-label">{t('geometry.method.label')}</legend>
      <div class="segmented">
        {#each METHODS as entry (entry.id)}
          <button
            type="button"
            aria-pressed={method === entry.id}
            onclick={() => {
              sfx.play('tick');
              method = entry.id;
            }}>{t(entry.label)}</button
          >
        {/each}
      </div>
      <p class="hint">{t(methodHint)}</p>
    </fieldset>

    <dl class="weights">
      <div class="weight">
        <dt class="field-label">{t('geometry.image.weightNow')}</dt>
        <dd class="weight-value">{weightNow}</dd>
      </div>
      <div class="weight">
        <dt class="field-label">{t('geometry.image.weightAfter')}</dt>
        <dd class="weight-value">{weightAfter}</dd>
      </div>
    </dl>

    <div class="dialog-actions">
      <button type="button" class="btn btn-quiet" onclick={cancel}>{t('common.cancel')}</button>
      <button type="submit" class="btn btn-primary" disabled={problem !== null}>{t('geometry.ok')}</button>
    </div>
  </form>
</Dialog>

<style>
  @layer components {
    .group {
      display: grid;
      gap: var(--space-2);
      min-width: 0;
      border: 0;
    }

    .presets {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }

    .preset {
      min-height: 32px;
      padding: 0 var(--space-3);
      font: 800 0.8125rem/1 var(--font-display);
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
      background: var(--surface-2);
      border: 2px solid var(--line);
      border-radius: var(--radius-s);
      box-shadow: 0 2px 0 var(--depth);
      transition:
        background-color var(--dur-hover) var(--ease-sym),
        border-color var(--dur-hover) var(--ease-sym),
        transform var(--dur-hover) var(--ease-spring);

      &:hover:not(:disabled, [aria-pressed='true']) {
        color: var(--text);
        background: var(--surface-3);
        transform: translateY(-1px);
      }

      &:active:not(:disabled) {
        transform: translateY(2px);
        transition-duration: 60ms;
      }

      &[aria-pressed='true'] {
        color: var(--on-primary);
        background: var(--primary);
        border-color: var(--primary-edge);
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.4;
      }
    }

    .row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }

    .unit {
      width: 7rem;
    }

    .sides {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: end;
      gap: var(--space-2);
    }

    .chain {
      width: 36px;
      height: 36px;
    }

    .invalid {
      color: var(--danger-text);
    }

    .weights {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-3);
      padding: var(--space-3);
      background: var(--surface-sunken);
      border: 2px solid var(--line);
      border-radius: var(--radius-m);
    }

    .weight {
      display: grid;
      gap: var(--space-1);
    }

    .weight-value {
      font: 800 1.0625rem/1.2 var(--font-display);
      font-variant-numeric: tabular-nums;
    }
  }
</style>
