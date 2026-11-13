import { fromStore, get } from 'svelte/store';
import type { Rect } from '../core/types.ts';
import type { StagePointer } from '../ui/stage-renderer.ts';
import type { EditorDoc } from './doc.svelte.ts';
import { t } from './i18n/index.ts';
import type { Layer } from './layers.ts';
import * as sfx from './sfx.ts';
import { app } from './state.svelte.ts';
import { selectSettings, setSelectSettings, type StoredAlignRef } from './tools/marquee-rect.ts';
import { layerAt, layerBounds, visibleLayerBoxes, type LayerBox } from './tools/move.ts';

// The reference of the six align actions: the stage, or a layer that the mode resolves to. The bar, the overlay and
// the actions read it from here, so the chip always names the object that an align uses.

export type AlignRefMode = StoredAlignRef | 'pick';

/** What an align uses: `layerId` null is the stage. `rect` is in document px (visible bounds for a layer). */
export interface AlignTarget {
  layerId: number | null;
  name: string;
  rect: Rect;
}

/** The auto reference that the last align used; it holds while the active layer stays where that align put it. */
interface AutoLock {
  doc: EditorDoc;
  activeId: number;
  image: Layer['image'];
  x: number;
  y: number;
  refId: number | null;
}

const settings = fromStore(selectSettings);

let picked = $state.raw<{ doc: EditorDoc; id: number } | null>(null);
let lock = $state.raw<AutoLock | null>(null);
let pickHandler = $state.raw<((p: StagePointer) => void) | null>(null);
let pickToast = 0;
let hot = $state(false);
let preview = $state<AlignRefMode | null>(null);
let flash: { rect: Rect; at: number } | null = null;

function stageTarget(doc: EditorDoc): AlignTarget {
  return { layerId: null, name: t('select.align.ref.stage'), rect: { x: 0, y: 0, w: doc.width, h: doc.height } };
}

function targetOf(box: LayerBox): AlignTarget {
  return { layerId: box.layer.id, name: box.layer.name, rect: box.bounds };
}

function boxOf(doc: EditorDoc, id: number): LayerBox | null {
  const layer = doc.layer(id);
  if (!layer || id === doc.activeId || !layer.visible || layer.opacity <= 0) return null;
  const bounds = layerBounds(doc, layer);
  return bounds ? { layer, bounds } : null;
}

function coversStage(doc: EditorDoc, r: Rect): boolean {
  return r.x <= 0 && r.y <= 0 && r.x + r.w >= doc.width && r.y + r.h >= doc.height;
}

function lockTarget(doc: EditorDoc): AlignTarget | null {
  const held = lock;
  const active = doc.active;
  if (!held || held.doc !== doc || !active || active.id !== held.activeId) return null;
  if (active.x !== held.x || active.y !== held.y || active.image !== held.image) return null;
  if (held.refId === null) return stageTarget(doc);
  const box = boxOf(doc, held.refId);
  return box ? targetOf(box) : null;
}

/** The smallest layer under the center of the active layer that does not cover the stage; the stage when none. */
function autoTarget(doc: EditorDoc): AlignTarget {
  const held = lockTarget(doc);
  if (held) return held;
  const active = doc.active;
  const b = active ? layerBounds(doc, active) : null;
  if (!active || !b) return stageTarget(doc);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  let best: LayerBox | null = null;
  let bestArea = Infinity;
  // Bottom first, so `<=` keeps the top layer on a tie.
  for (const box of visibleLayerBoxes(doc, active.id)) {
    const r = box.bounds;
    if (cx < r.x || cx > r.x + r.w || cy < r.y || cy > r.y + r.h || coversStage(doc, r)) continue;
    const area = r.w * r.h;
    if (area <= bestArea) {
      best = box;
      bestArea = area;
    }
  }
  return best ? targetOf(best) : stageTarget(doc);
}

function belowTarget(doc: EditorDoc): AlignTarget | null {
  const activeId = doc.activeId;
  if (activeId === null) return null;
  const index = doc.indexOf(activeId);
  let found: LayerBox | null = null;
  for (const box of visibleLayerBoxes(doc, activeId)) {
    if (doc.indexOf(box.layer.id) < index) found = box;
  }
  return found ? targetOf(found) : null;
}

function pickedTarget(doc: EditorDoc): AlignTarget | null {
  if (!picked || picked.doc !== doc) return null;
  const box = boxOf(doc, picked.id);
  return box ? targetOf(box) : null;
}

/** The mode that applies now: a layer picked on the stage, else the stored mode. */
export function alignRefMode(): AlignRefMode {
  return picked && picked.doc === app.doc && app.doc?.layer(picked.id) ? 'pick' : settings.current.alignRef;
}

/** The reference of one mode; null when `below` or `pick` cannot resolve now. */
export function alignTargetOf(doc: EditorDoc, mode: AlignRefMode): AlignTarget | null {
  if (mode === 'stage') return stageTarget(doc);
  if (mode === 'below') return belowTarget(doc);
  if (mode === 'pick') return pickedTarget(doc);
  return autoTarget(doc);
}

/** The reference that an align uses now. A mode that cannot resolve gives what `auto` gives. */
export function alignTarget(doc: EditorDoc): AlignTarget {
  return alignTargetOf(doc, alignRefMode()) ?? autoTarget(doc);
}

/** The name of the layer that `pick` holds (it can be hidden or empty now), or null. */
export function pickedName(doc: EditorDoc): string | null {
  return picked && picked.doc === doc ? (doc.layer(picked.id)?.name ?? null) : null;
}

/** An align used `target`: in `auto` it stays the reference while the active layer stays where it is; the outline flashes. */
export function noteAligned(doc: EditorDoc, target: AlignTarget): void {
  const active = doc.active;
  lock = alignRefMode() === 'auto' && active ? { doc, activeId: active.id, image: active.image, x: active.x, y: active.y, refId: target.layerId } : null;
  flash = { rect: target.rect, at: performance.now() };
  app.stage?.invalidateFx();
}

/** Selects a stored mode. `pick` arms a press on the stage instead. */
export function setAlignRefMode(mode: AlignRefMode): void {
  if (mode === 'pick') {
    startAlignPick();
    return;
  }
  cancelAlignPick();
  picked = null;
  lock = null;
  if (get(selectSettings).alignRef !== mode) setSelectSettings({ alignRef: mode });
  app.stage?.invalidateFx();
}

export function alignPicking(): boolean {
  return pickHandler !== null;
}

function endPick(): void {
  pickHandler = null;
  if (pickToast) app.dismissToast(pickToast);
  pickToast = 0;
}

/** Arms a single press on the stage: a layer that counts becomes the reference. */
export function startAlignPick(): void {
  if (pickHandler) return;
  const handler = (p: StagePointer) => {
    const doc = app.doc;
    if (!doc) return endPick();
    const layer = layerAt(doc, p.ix, p.iy);
    const box = layer && layer.id !== doc.activeId ? boxOf(doc, layer.id) : null;
    if (!box) {
      app.refuse(t(layer && layer.id === doc.activeId ? 'select.align.ref.pickSelf' : 'select.align.ref.pickEmpty'));
      app.requestStagePick(handler);
      return;
    }
    endPick();
    picked = { doc, id: box.layer.id };
    lock = null;
    sfx.play('pick');
    app.stage?.invalidateFx();
  };
  pickHandler = handler;
  app.requestStagePick(handler);
  pickToast = app.toast(t('select.align.ref.pickHint'), 'info');
}

/** Ends an armed pick; the mode of before stays. */
export function cancelAlignPick(): void {
  if (!pickHandler) return;
  if (app.stagePick === pickHandler) app.requestStagePick(null);
  endPick();
}

/** The bar has the pointer, the focus or an open menu: the overlay shows the reference. */
export function setAlignRefHot(value: boolean): void {
  if (hot === value) return;
  hot = value;
  app.stage?.invalidateFx();
}

/** A menu row has the pointer or the focus: the overlay shows the reference of that row. */
export function setAlignRefPreview(mode: AlignRefMode | null): void {
  if (preview === mode) return;
  preview = mode;
  app.stage?.invalidateFx();
}

/** What the overlay draws now: the rect in document px and the start time of the flash (-1 when steady). */
export function alignOutline(doc: EditorDoc, now: number, durationMs: number): { rect: Rect; at: number } | null {
  if (hot && !pickHandler) {
    const target = preview ? alignTargetOf(doc, preview) : alignTarget(doc);
    if (target) return { rect: target.rect, at: -1 };
    if (preview) return null;
  }
  if (flash && now - flash.at < durationMs) return flash;
  flash = null;
  return null;
}

$effect.root(() => {
  // A pick that another part of the app replaced, or that a new document cleared, is over.
  $effect(() => {
    if (pickHandler && app.stagePick !== pickHandler) endPick();
  });
  // A picked layer that is removed, or a different document, ends the pick.
  $effect(() => {
    const doc = app.doc;
    if (picked && (picked.doc !== doc || !doc?.layer(picked.id))) picked = null;
  });
  // A different move, a different active layer, a hidden or removed reference: the lock is over for good.
  $effect(() => {
    const doc = app.doc;
    if (lock && (!doc || !lockTarget(doc))) lock = null;
  });
});
