import { inpaintContext } from '../core/inpaint/index.ts';
import { cropRaster, intersectRect, readRect } from '../core/raster.ts';
import type { RasterImage, Rect } from '../core/types.ts';
import type { EditorDoc } from './doc.svelte.ts';
import { t, type TextKey } from './i18n/index.ts';
import { isRenderedLayer } from './layers.ts';
import * as sfx from './sfx.ts';
import { app, prefersReducedMotion } from './state.svelte.ts';
import { strokeIdle } from './tools/brush.ts';
import { TUNING } from './tuning/index.ts';

/** The area to fill: coverage 0..255 of `rect` (layer px), row-major. */
export interface HoleCover { rect: Rect; data: Uint8Array }

/** A fill job of the queue, for the overlay: queued, running, or landed and still in its fade. */
export interface PendingHeal {
  readonly doc: EditorDoc;
  readonly layerId: number;
  readonly hole: HoleCover;
  /** The time (performance.now) when the result landed; null while the job waits or runs. */
  readonly landedAt: number | null;
}

interface Job extends PendingHeal {
  /** The layer image when the job was queued: the hole is in its px. */
  readonly image: RasterImage | null;
  landedAt: number | null;
  cancelled: boolean;
}

/** One serial chain for all documents: the worker lane runs one fill at a time anyway. */
let chain: Promise<void> = Promise.resolve();
let jobs: readonly Job[] = [];

function setJobs(next: readonly Job[]): void {
  jobs = next;
  app.stage?.invalidateFx();
}

function drop(job: Job): void {
  if (jobs.includes(job)) setJobs(jobs.filter((other) => other !== job));
}

/** The landed job stays in the list for its fade, so the mark melts into the new pixels. */
function land(job: Job): void {
  if (prefersReducedMotion()) {
    drop(job);
    return;
  }
  job.landedAt = performance.now();
  app.stage?.invalidateFx();
  setTimeout(() => drop(job), TUNING.paint.healMark.fadeMs);
}

/** The bytes of `rect` (crop px) in the crop, as readRect gives them. */
function cropBytes(region: { width: number; data: Uint8ClampedArray }, rect: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  const rowBytes = rect.w * 4;
  for (let y = 0; y < rect.h; y++) {
    const from = ((rect.y + y) * region.width + rect.x) * 4;
    out.set(region.data.subarray(from, from + rowBytes), y * rowBytes);
  }
  return out;
}

function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function runJob(job: Job, label: TextKey, strength: number): Promise<void> {
  if (job.cancelled) return;
  const { doc, layerId, hole } = job;
  let landed = false;
  try {
    const layer = doc.layer(layerId);
    if (!app.isOpen(doc) || !layer || isRenderedLayer(layer)) return;
    if (layer.image !== job.image) {
      app.refuse(t('paint.toast.healChanged'));
      return;
    }
    const image = layer.image;
    const bounds = intersectRect(hole.rect, { x: 0, y: 0, w: image.width, h: image.height });
    if (!bounds) return;
    const raw = inpaintContext(bounds, image.width, image.height);
    const context: Rect = { x: Math.round(raw.x), y: Math.round(raw.y), w: Math.round(raw.w), h: Math.round(raw.h) };
    const region = cropRaster(image, context);
    const cropHole = new Uint8Array(region.width * region.height);
    const inside = intersectRect(hole.rect, context);
    if (inside) {
      for (let y = inside.y; y < inside.y + inside.h; y++) {
        const from = (y - hole.rect.y) * hole.rect.w - hole.rect.x;
        const to = (y - context.y) * region.width - context.x;
        cropHole.set(hole.data.subarray(from + inside.x, from + inside.x + inside.w), to + inside.x);
      }
    }
    const outcome = await app.track(app.engine.inpaint(region, cropHole, strength), 'paint.progress.heal');
    // A stroke in progress writes its old tiles back on release, which would undo a patch that lands under it.
    await strokeIdle();
    if (job.cancelled || !app.isOpen(doc) || outcome.kind === 'cancelled') return;
    if (outcome.kind === 'no-source') {
      app.refuse(t('paint.toast.healNoSource'));
      return;
    }
    const local = outcome.rect;
    const rect: Rect = { x: context.x + local.x, y: context.y + local.y, w: local.w, h: local.h };
    const now = doc.layer(layerId);
    // commitPatch writes in place, so a change of the same image shows only in its bytes.
    const before = now && now.image === image ? readRect(image, rect) : null;
    if (!before || !sameBytes(before, cropBytes(region, local))) {
      app.refuse(t('paint.toast.healChanged'));
      return;
    }
    const after = outcome.image.data;
    if (sameBytes(before, after)) return;
    doc.commitPatch(layerId, { rect, before, after }, label);
    sfx.play('fill');
    landed = true;
  } catch (error) {
    app.fail(error);
  } finally {
    if (landed) land(job);
    else drop(job);
  }
}

/**
 * Queues a content-aware fill of the hole on a plain raster layer, from the pixels of that layer around it. The result
 * is one undo step with `label`; strength 0..1 blends it with the old pixels. The job checks its layer when it starts,
 * not when it is queued.
 */
export function healHole(doc: EditorDoc, layerId: number, hole: HoleCover, label: TextKey, strength = 1): Promise<void> {
  const image = doc.layer(layerId)?.image ?? null;
  const job: Job = { doc, layerId, hole, image, landedAt: null, cancelled: false };
  setJobs([...jobs, job]);
  const run = chain.then(() => runJob(job, label, strength));
  chain = run;
  return run;
}

/** The queued, running and fading jobs of the document, oldest first. */
export function pendingHeals(doc: EditorDoc): readonly PendingHeal[] {
  return jobs.filter((job) => job.doc === doc);
}

/** True while a job waits or runs (a landed job in its fade does not count). */
export function healsPending(): boolean {
  return jobs.some((job) => job.landedAt === null);
}

/** Drops every queued job and stops the running one. False when there was nothing to cancel. */
export function cancelHeals(): boolean {
  const open = jobs.filter((job) => job.landedAt === null);
  if (open.length === 0) return false;
  for (const job of open) job.cancelled = true;
  setJobs(jobs.filter((job) => job.landedAt !== null));
  app.engine.cancelInpaint();
  app.refuse(t('paint.toast.healCancelled'));
  return true;
}
