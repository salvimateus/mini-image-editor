import { applyAdjust, applyAdjustCovered, applyAdjustRegion, histogram, renderVignette } from '../adjust/index.ts';
import { coverageOf, proxyCoverage } from '../adjust/common.ts';
import { CoreError } from '../errors.ts';
import { PARAMS } from '../params/index.ts';
import { resetAdjustSession, type AdjustSession, type Handler } from '../protocol.ts';
import { resizeRaster } from '../resample.ts';
import type { RasterImage } from '../types.ts';
import { checkLimits } from './decode.ts';

const PROXY_COVER = 'proxy-cover';

function isRaster(value: unknown): value is RasterImage {
  const image = value as Partial<RasterImage> | null;
  return (
    !!image &&
    Number.isInteger(image.width) &&
    Number.isInteger(image.height) &&
    (image.width ?? 0) > 0 &&
    (image.height ?? 0) > 0 &&
    image.data instanceof Uint8ClampedArray &&
    image.data.length === (image.width ?? 0) * (image.height ?? 0) * 4
  );
}

function sourceOf(session: AdjustSession): RasterImage {
  if (!session.source) throw new CoreError('internal', 'No adjust session: call adjust-begin first.');
  return session.source;
}

/** Keeps the source, the mask and the offset; makes a proxy of a large source; replies with the histogram. */
export const adjustBegin: Handler<'adjust-begin'> = (request, context) => {
  const { session } = context;
  resetAdjustSession(session);
  if (!isRaster(request.image)) throw new CoreError('internal', 'adjust-begin needs a non-empty RGBA image.');
  const image = request.image;
  const mask = request.mask && request.mask.bounds ? request.mask : null;
  const offset = { x: Math.round(request.offset?.x ?? 0), y: Math.round(request.offset?.y ?? 0) };
  session.source = image;
  session.mask = mask;
  session.offset = offset;
  const pixels = image.width * image.height;
  const limit = PARAMS.adjust.proxyMaxPixels;
  if (pixels > limit) {
    const scale = Math.sqrt(limit / pixels);
    const pw = Math.max(1, Math.round(image.width * scale));
    const ph = Math.max(1, Math.round(image.height * scale));
    session.proxy = resizeRaster(image, pw, ph, 'smooth');
    session.proxyScale = pw / image.width;
    session.cache.set(PROXY_COVER, proxyCoverage(mask, image.width, image.height, offset, pw, ph));
  }
  const hist = histogram(image, coverageOf(mask, image.width, image.height, offset));
  return {
    reply: { type: 'adjust-begin', histogram: hist },
    transfer: [hist.r.buffer, hist.g.buffer, hist.b.buffer, hist.luma.buffer],
  };
};

/** region null: the whole layer on the proxy (scale < 1 when a proxy exists); a region: that full-resolution crop. */
export const adjustPreview: Handler<'adjust-preview'> = (request, context) => {
  const { session } = context;
  const source = sourceOf(session);
  if (request.region) {
    const result = applyAdjustRegion(source, request.op, session.mask, session.offset, request.region, { cache: session.cache, cacheKey: 'region' });
    if (!result) throw new CoreError('internal', 'The preview region is outside the layer.');
    return { reply: { type: 'adjust-preview', image: result.image, rect: result.rect, scale: 1 }, transfer: [result.image.data.buffer] };
  }
  const rect = { x: 0, y: 0, w: source.width, h: source.height };
  if (session.proxy) {
    const cover = (session.cache.get(PROXY_COVER) as Uint8Array | null | undefined) ?? null;
    const image = applyAdjustCovered(session.proxy, request.op, cover, { cache: session.cache, cacheKey: 'proxy', pixelScale: session.proxyScale });
    return { reply: { type: 'adjust-preview', image, rect, scale: session.proxyScale }, transfer: [image.data.buffer] };
  }
  const image = applyAdjust(source, request.op, session.mask, session.offset, { cache: session.cache, cacheKey: 'full' });
  return { reply: { type: 'adjust-preview', image, rect, scale: 1 }, transfer: [image.data.buffer] };
};

/** The op on the full source, with progress events. The session stays open. */
export const adjustCommit: Handler<'adjust-commit'> = (request, context) => {
  const { session } = context;
  const source = sourceOf(session);
  context.progress(0);
  // A small source shares the cache of its whole-layer previews; a large one keeps no full-size plane alive.
  const cache = session.proxy ? undefined : session.cache;
  const image = applyAdjust(source, request.op, session.mask, session.offset, { cache, cacheKey: 'full', onProgress: (ratio) => context.progress(ratio) });
  return { reply: { type: 'adjust-commit', image }, transfer: [image.data.buffer] };
};

export const adjustEnd: Handler<'adjust-end'> = (_request, context) => {
  resetAdjustSession(context.session);
  return { reply: { type: 'adjust-end' } };
};

export const vignette: Handler<'vignette'> = (request, context) => {
  const width = Math.round(request.width);
  const height = Math.round(request.height);
  if (!(width > 0 && height > 0)) throw new CoreError('internal', `The vignette size ${request.width} x ${request.height} is not valid.`);
  checkLimits({ width, height });
  const image = renderVignette(width, height, request.params, (ratio) => context.progress(ratio));
  return { reply: { type: 'vignette', image }, transfer: [image.data.buffer] };
};
