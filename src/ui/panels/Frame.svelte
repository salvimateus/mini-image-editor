<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { frameWidth, sameFrame } from '../../core/adjust/index.ts';
  import { flatten } from '../../core/composite.ts';
  import { CoreError } from '../../core/errors.ts';
  import { PARAMS } from '../../core/params/index.ts';
  import { cropRaster } from '../../core/raster.ts';
  import type { FrameParams, RasterImage } from '../../core/types.ts';
  import type { EditorDoc, LayerPreview } from '../../app/doc.svelte.ts';
  import { frameImage, frameLayers, prepareGenerators, type FrameLayer } from '../../app/generators.ts';
  import { t } from '../../app/i18n/index.ts';
  import { lastFrame, saveFrame } from '../../app/last-used.ts';
  import { createRasterLayer, type Layer, type RasterLayer } from '../../app/layers.ts';
  import { app } from '../../app/state.svelte.ts';
  import { TUNING } from '../../app/tuning/index.ts';
  import SliderField from '../base/SliderField.svelte';
  import ToggleSwitch from '../base/ToggleSwitch.svelte';
  import AdjustPanel from './AdjustPanel.svelte';
  import ColorField from './ColorField.svelte';

  const tuning = TUNING.adjust.frame;
  const DEFAULTS: FrameParams = { width: tuning.width.default, color: { ...tuning.defaultColor } };
  const imageIds = new WeakMap<RasterImage, number>();
  let lastImageId = 0;

  // A new frame starts from the last applied one; Reset goes back to the defaults.
  const start = lastFrame();
  let params = $state<FrameParams>(start.params);
  let grow = $state<boolean>(start.grow);
  let preview = $state(true);
  let applying = false;
  let ownPreview: LayerPreview | null = null;
  let ownDoc: EditorDoc | null = null;
  let frameId = 0;
  /** The flattened stage for the grown preview, kept while the layers stay the same. */
  let flatCache: { key: string; image: RasterImage } | null = null;

  const doc = $derived(app.doc);
  const existing = $derived<FrameLayer | null>(doc ? (frameLayers(doc).at(-1) ?? null) : null);
  const baseline = $derived<FrameParams>(existing ? cleanFrame(existing.generator.params) : DEFAULTS);
  const growing = $derived(!existing && grow);
  const canApply = $derived(existing ? !sameFrame(cleanFrame(params), baseline) : true);
  const canReset = $derived(!sameFrame(cleanFrame(params), baseline) || (!existing && grow !== tuning.growDefault));

  function cleanFrame(value: FrameParams): FrameParams {
    const { min, max } = tuning.width;
    const width = Math.round(Math.min(max, Math.max(min, Number.isFinite(value.width) ? value.width : DEFAULTS.width)));
    const { r, g, b } = value.color;
    return { width, color: { r, g, b, a: 255 } };
  }

  function imageId(image: RasterImage): number {
    let id = imageIds.get(image);
    if (id === undefined) {
      id = ++lastImageId;
      imageIds.set(image, id);
    }
    return id;
  }

  /** The topmost visible layer: with no frame layer yet, the preview draws over it. */
  function hostLayer(target: EditorDoc): Layer | null {
    for (let i = target.layers.length - 1; i >= 0; i--) {
      const layer = target.layers[i];
      if (layer.visible && layer.opacity > 0) return layer;
    }
    return null;
  }

  /** Changes when any visible pixel or position may have changed, for the preview caches. */
  function layersKey(target: EditorDoc): string {
    return target.layers.map((layer) => `${layer.id}:${imageId(layer.image)}:${layer.x},${layer.y}:${layer.visible ? layer.opacity : 0}`).join('|');
  }

  // A new document, a new stage size or another frame layer starts the panel again from that layer.
  const startKey = $derived(
    doc ? `${doc.width}x${doc.height}:${existing ? `${existing.id}:${JSON.stringify(existing.generator.params)}` : 'new'}` : 'none',
  );
  const hostKey = $derived(doc && !existing ? layersKey(doc) : '');

  $effect(() => {
    void startKey;
    untrack(() => {
      const from = existing ? baseline : lastFrame().params;
      params = { width: from.width, color: { ...from.color } };
      if (ownDoc) setOwnPreview(ownDoc, null);
    });
  });

  // One preview per animation frame: a slider drag gives many values, the stage needs only the last.
  $effect(() => {
    void params;
    void preview;
    void grow;
    void startKey;
    void hostKey;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(() => {
      frameId = 0;
      untrack(showPreview);
    });
  });

  onDestroy(() => {
    if (frameId) cancelAnimationFrame(frameId);
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

  function showPreview(): void {
    const target = app.doc;
    if (!target || applying) return;
    const p = cleanFrame(params);
    const layer = existing;
    if (!preview || (layer && sameFrame(p, baseline))) {
      setOwnPreview(target, null);
      return;
    }
    const { width, height } = target;
    if (layer) {
      setOwnPreview(target, { layerId: layer.id, image: frameImage(width, height, p), rect: { x: -layer.x, y: -layer.y, w: width, h: height }, scale: 1 });
      return;
    }
    const host = hostLayer(target);
    if (!host) {
      setOwnPreview(target, null);
      return;
    }
    const rect = { x: -host.x, y: -host.y, w: width, h: height };
    if (!growing) {
      const shown = flatten(width, height, [
        { image: cropRaster(host.image, rect), x: 0, y: 0, opacity: 1 },
        { image: frameImage(width, height, p), x: 0, y: 0, opacity: 1 },
      ]);
      setOwnPreview(target, { layerId: host.id, image: shown, rect, scale: 1 });
      return;
    }
    // The grown result does not fit the stage yet: the whole result shows scaled down into the stage.
    const key = layersKey(target);
    if (!flatCache || flatCache.key !== key) flatCache = { key, image: target.flatten() };
    const grownW = width + 2 * p.width;
    const grownH = height + 2 * p.width;
    const shown = flatten(grownW, grownH, [
      { image: flatCache.image, x: p.width, y: p.width, opacity: 1 },
      { image: frameImage(grownW, grownH, p), x: 0, y: 0, opacity: 1 },
    ]);
    setOwnPreview(target, { layerId: host.id, image: shown, rect, scale: Math.max(grownW / width, grownH / height) });
  }

  async function apply(): Promise<boolean> {
    const target = app.doc;
    if (!target || !canApply) return false;
    const p = cleanFrame(params);
    const current = frameLayers(target).at(-1) ?? null;
    const grown = !current && grow;
    const w = grown ? target.width + 2 * p.width : target.width;
    const h = grown ? target.height + 2 * p.width : target.height;
    const { maxSide, maxPixels } = PARAMS.limits;
    if (w > maxSide || h > maxSide || w * h > maxPixels) {
      app.fail(new CoreError('too-large', `The stage would be ${w} x ${h}.`));
      return false;
    }
    applying = true;
    try {
      const putGenerated = grown ? await app.track(prepareGenerators(target, w, h)) : null;
      if (app.doc !== target) return false;
      setOwnPreview(target, null);
      const image = frameImage(w, h, p);
      const generator = { kind: 'frame' as const, params: { width: p.width, color: { ...p.color } } };
      saveFrame(p, current ? lastFrame().grow : grow);
      const activeId = target.activeId;
      if (current) {
        const index = target.indexOf(current.id);
        const next: RasterLayer = { ...createRasterLayer(current.name, image, 0, 0), visible: current.visible, opacity: current.opacity, generator };
        target.batch('history.frame', () => {
          target.removeLayer(current.id);
          target.addLayer(next, index, 'history.frame');
        });
        target.setActive(activeId === current.id ? next.id : activeId);
        return true;
      }
      const next: RasterLayer = { ...createRasterLayer(t('doc.frameName'), image, 0, 0), generator };
      target.batch('history.frame', () => {
        if (grown) {
          target.setStage({ x: -p.width, y: -p.width, w, h }, null, 'history.frame');
          putGenerated?.();
        }
        target.addLayer(next, target.layers.length, 'history.frame');
      });
      // The frame sits on top; painting goes on in the layer the user had chosen.
      target.setActive(activeId);
      return true;
    } finally {
      applying = false;
    }
  }

  const generatorControl = { apply };

  function reset(): void {
    params = { width: baseline.width, color: { ...baseline.color } };
    grow = tuning.growDefault;
  }

  /** The stage size now and after Apply, so the switch never changes the file size by surprise. */
  const sizeHint = $derived.by(() => {
    if (!doc) return '';
    const side = cleanFrame(params).width;
    const from = `${doc.width} × ${doc.height}`;
    if (!grow) return t('adjust.frame.coverHint', { from });
    return t('adjust.frame.growHint', { from, to: `${doc.width + 2 * side} × ${doc.height + 2 * side}` });
  });

  const note = $derived(existing ? t('adjust.frame.editing', { name: existing.name }) : t('adjust.frame.new'));
  // Without growing, a border wider than half of the shorter side would fill the stage.
  const shownLimit = $derived(doc ? frameWidth(doc.width, doc.height, { width: Number.MAX_SAFE_INTEGER, color: params.color }) : 0);
  const clamped = $derived(!!doc && !growing && params.width > shownLimit);
</script>

<AdjustPanel
  titleId="panel-frame-title"
  title={t('action.adjust.frame')}
  label="history.frame"
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
      id="adjust-frame-width"
      label={t('adjust.frame.width')}
      value={params.width}
      min={tuning.width.min}
      max={tuning.width.max}
      step={tuning.width.step}
      unit="px"
      reset={DEFAULTS.width}
      {disabled}
      oninput={(width) => (params = { ...params, width })}
      onchange={(width) => (params = { ...params, width })}
    />
    {#if clamped}<p class="hint frame-warn" role="status">{t('adjust.frame.clamped', { n: shownLimit })}</p>{/if}
    <ColorField id="adjust-frame-color" label={t('adjust.frame.color')} color={params.color} onchange={(color) => (params = { ...params, color: { ...color, a: 255 } })} />
    {#if !existing}
      <ToggleSwitch id="adjust-frame-grow" label={t('adjust.frame.grow')} checked={grow} {disabled} onchange={(on) => (grow = on)} />
      <p class="hint" aria-live="polite">{sizeHint}</p>
    {/if}
  {/snippet}
</AdjustPanel>

<style>
  @layer components {
    .frame-warn {
      color: var(--yellow);
      font-weight: 700;
    }
  }
</style>
