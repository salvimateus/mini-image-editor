<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { cleanVignette, sameVignette, VIGNETTE_RANGES } from '../../core/adjust/index.ts';
  import { flatten } from '../../core/composite.ts';
  import { cropRaster } from '../../core/raster.ts';
  import type { RasterImage, VignetteParams } from '../../core/types.ts';
  import type { EditorDoc, LayerPreview } from '../../app/doc.svelte.ts';
  import { vignetteImage, vignetteLayers, type GeneratedLayer } from '../../app/generators.ts';
  import { t } from '../../app/i18n/index.ts';
  import { createRasterLayer, type Layer, type RasterLayer } from '../../app/layers.ts';
  import { app } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import SliderField from '../base/SliderField.svelte';
  import AdjustPanel from './AdjustPanel.svelte';

  const DEFAULTS: VignetteParams = { ...TUNING.adjust.vignette.defaults };
  const imageIds = new WeakMap<RasterImage, number>();
  let lastImageId = 0;

  let params = $state<VignetteParams>({ ...DEFAULTS });
  let preview = $state(true);
  let noHost = $state(false);
  let applying = false;
  let ownPreview: LayerPreview | null = null;
  let ownDoc: EditorDoc | null = null;
  let pumping = false;
  let again = false;

  const doc = $derived(app.doc);
  const existing = $derived<GeneratedLayer | null>(doc ? (vignetteLayers(doc).at(-1) ?? null) : null);
  const baseline = $derived<VignetteParams>(existing ? cleanVignette(existing.generator.params) : DEFAULTS);
  const canApply = $derived(existing ? !sameVignette(params, baseline) : params.amount !== 0);
  const canReset = $derived(!sameVignette(params, baseline));

  function imageId(image: RasterImage): number {
    let id = imageIds.get(image);
    if (id === undefined) {
      id = ++lastImageId;
      imageIds.set(image, id);
    }
    return id;
  }

  /** The topmost visible layer: with no vignette layer yet, the preview draws over it. */
  function hostLayer(target: EditorDoc): Layer | null {
    for (let i = target.layers.length - 1; i >= 0; i--) {
      const layer = target.layers[i];
      if (layer.visible && layer.opacity > 0) return layer;
    }
    return null;
  }

  // A new document, a new stage size or another vignette layer starts the panel again from that layer.
  const startKey = $derived(
    doc ? `${doc.width}x${doc.height}:${existing ? `${existing.id}:${Object.values(existing.generator.params).join(',')}` : 'new'}` : 'none',
  );
  const hostKey = $derived.by(() => {
    if (!doc || existing) return '';
    const host = hostLayer(doc);
    return host ? `${host.id}:${imageId(host.image)}:${host.x},${host.y}` : 'none';
  });

  $effect(() => {
    void startKey;
    untrack(() => {
      params = { ...baseline };
      if (ownDoc) setOwnPreview(ownDoc, null);
    });
  });

  $effect(() => {
    void params;
    void preview;
    void startKey;
    void hostKey;
    // The pump reads the document preview that it writes: only the values above may start it.
    untrack(() => void pump());
  });

  onDestroy(() => {
    if (ownDoc) setOwnPreview(ownDoc, null);
  });

  function setOwnPreview(target: EditorDoc, next: LayerPreview | null): void {
    if (!next) {
      if (ownPreview && target.preview === ownPreview) target.setPreview(null);
      ownPreview = null;
      return;
    }
    ownDoc = target;
    target.setPreview(next);
    ownPreview = next;
  }

  async function pump(): Promise<void> {
    if (pumping) {
      again = true;
      return;
    }
    pumping = true;
    try {
      do {
        again = false;
        const target = app.doc;
        if (!target || applying) return;
        const p = cleanVignette(params);
        const layer = existing;
        const quiet = !preview || (layer ? sameVignette(p, baseline) : p.amount === 0);
        if (quiet) {
          noHost = false;
          setOwnPreview(target, null);
          continue;
        }
        const { width, height } = target;
        const image = await app.engine.vignette(width, height, p);
        if (!image || applying || app.doc !== target || target.width !== width || target.height !== height) continue;
        if (layer) {
          noHost = false;
          setOwnPreview(target, { layerId: layer.id, image, rect: { x: -layer.x, y: -layer.y, w: width, h: height }, scale: 1 });
          continue;
        }
        const host = hostLayer(target);
        noHost = !host;
        if (!host) {
          setOwnPreview(target, null);
          continue;
        }
        const rect = { x: -host.x, y: -host.y, w: width, h: height };
        const base = cropRaster(host.image, rect);
        const shown = flatten(width, height, [
          { image: base, x: 0, y: 0, opacity: 1 },
          { image, x: 0, y: 0, opacity: 1 },
        ]);
        setOwnPreview(target, { layerId: host.id, image: shown, rect, scale: 1 });
      } while (again);
    } catch (error) {
      app.fail(error);
    } finally {
      pumping = false;
      if (again && !applying) void pump();
    }
  }

  async function apply(): Promise<boolean> {
    const target = app.doc;
    if (!target || !canApply) return false;
    applying = true;
    try {
      const p = cleanVignette(params);
      const image = await app.track(vignetteImage(target.width, target.height, p));
      if (app.doc !== target) return false;
      setOwnPreview(target, null);
      const generator = { kind: 'vignette' as const, params: p };
      const current = vignetteLayers(target).at(-1) ?? null;
      const activeId = target.activeId;
      if (current) {
        const index = target.indexOf(current.id);
        const next: RasterLayer = { ...createRasterLayer(current.name, image, 0, 0), visible: current.visible, opacity: current.opacity, generator };
        target.batch('adjust.history.vignette', () => {
          target.removeLayer(current.id);
          target.addLayer(next, index, 'adjust.history.vignette');
        });
        target.setActive(activeId === current.id ? next.id : activeId);
      } else {
        const next: RasterLayer = { ...createRasterLayer(t('adjust.vignette.layerName'), image, 0, 0), generator };
        target.addLayer(next, target.layers.length, 'adjust.history.vignetteAdd');
        // The new layer sits on top; painting goes on in the layer the user had chosen.
        target.setActive(activeId);
      }
      return true;
    } finally {
      applying = false;
    }
  }

  const generatorControl = { apply };

  function set(patch: Partial<VignetteParams>): void {
    params = { ...params, ...patch };
  }

  function reset(): void {
    params = { ...baseline };
  }

  const direction = $derived(params.amount < 0 ? t('adjust.vignette.dark') : params.amount > 0 ? t('adjust.vignette.light') : t('adjust.vignette.off'));
  const note = $derived(existing ? t('adjust.vignette.editing', { name: existing.name }) : t('adjust.vignette.new'));
</script>

<AdjustPanel
  titleId="panel-vignette-title"
  title={t('action.adjust.vignette')}
  label="adjust.history.vignette"
  generator={generatorControl}
  {canApply}
  blocked={doc ? null : t('adjust.blocked.noDoc')}
  {note}
  {canReset}
  onreset={reset}
  bind:preview
>
  {#snippet children({ disabled })}
    <SliderField
      id="adjust-vignette-amount"
      label={t('adjust.vignette.amount')}
      value={params.amount}
      min={VIGNETTE_RANGES.amount.min}
      max={VIGNETTE_RANGES.amount.max}
      step={1}
      reset={0}
      {disabled}
      oninput={(amount) => set({ amount })}
      onchange={(amount) => set({ amount })}
    />
    <p class="hint direction" class:is-dark={params.amount < 0} class:is-light={params.amount > 0}>{direction}</p>
    <SliderField
      id="adjust-vignette-size"
      label={t('adjust.vignette.size')}
      value={params.size}
      min={VIGNETTE_RANGES.size.min}
      max={VIGNETTE_RANGES.size.max}
      step={1}
      reset={DEFAULTS.size}
      {disabled}
      oninput={(size) => set({ size })}
      onchange={(size) => set({ size })}
    />
    <SliderField
      id="adjust-vignette-roundness"
      label={t('adjust.vignette.roundness')}
      value={params.roundness}
      min={VIGNETTE_RANGES.roundness.min}
      max={VIGNETTE_RANGES.roundness.max}
      step={1}
      reset={DEFAULTS.roundness}
      {disabled}
      oninput={(roundness) => set({ roundness })}
      onchange={(roundness) => set({ roundness })}
    />
    <SliderField
      id="adjust-vignette-feather"
      label={t('adjust.vignette.feather')}
      value={params.feather}
      min={VIGNETTE_RANGES.feather.min}
      max={VIGNETTE_RANGES.feather.max}
      step={1}
      reset={DEFAULTS.feather}
      {disabled}
      oninput={(feather) => set({ feather })}
      onchange={(feather) => set({ feather })}
    />
    {#if noHost && preview}<p class="hint" role="status">{t('adjust.vignette.noPreview')}</p>{/if}
  {/snippet}
</AdjustPanel>

<style>
  @layer components {
    .direction {
      margin-top: calc(var(--space-2) * -1);
      font-size: 0.75rem;
      font-weight: 700;

      &.is-dark,
      &.is-light {
        color: var(--text);
      }
    }
  }
</style>
