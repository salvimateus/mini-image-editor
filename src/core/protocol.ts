import type { ErrorCode } from './errors.ts';
import type { Mask } from './mask.ts';
import type { AdjustOp, ExportOptions, Histogram, Point, RasterImage, Rect, ResampleMethod, VignetteParams } from './types.ts';

export type { ErrorCode } from './errors.ts';

export type EngineRequest =
  | { id: number; type: 'decode'; bytes: ArrayBuffer; name: string }
  /** offset = layer position in document px. */
  | { id: number; type: 'adjust-begin'; image: RasterImage; mask: Mask | null; offset: Point }
  /** region in layer px: a full resolution crop; null: a proxy of the whole layer. */
  | { id: number; type: 'adjust-preview'; op: AdjustOp; region: Rect | null }
  | { id: number; type: 'adjust-commit'; op: AdjustOp }
  | { id: number; type: 'adjust-end' }
  | { id: number; type: 'vignette'; width: number; height: number; params: VignetteParams }
  | { id: number; type: 'resize'; image: RasterImage; width: number; height: number; method: ResampleMethod }
  | { id: number; type: 'estimate' | 'export'; image: RasterImage; options: ExportOptions };

export type EngineReply =
  | { id: number; ok: true; type: 'decode'; image: RasterImage; format: string }
  | { id: number; ok: true; type: 'adjust-begin'; histogram: Histogram }
  | { id: number; ok: true; type: 'adjust-preview'; image: RasterImage; rect: Rect; scale: number }
  | { id: number; ok: true; type: 'adjust-commit' | 'vignette' | 'resize'; image: RasterImage }
  | { id: number; ok: true; type: 'adjust-end' }
  | { id: number; ok: true; type: 'estimate'; plainBytes: number; bytes: number }
  | { id: number; ok: true; type: 'export'; data: ArrayBuffer; plainBytes: number }
  | { id: number; ok: false; error: ErrorCode; detail?: string };

export type EngineEvent = { id: number; type: 'progress'; ratio: number };

export type WorkerMessage = EngineReply | EngineEvent;

export type RequestType = EngineRequest['type'];

export type SuccessReply = Extract<EngineReply, { ok: true }>;

/** The request of one type, with `type` narrowed (some members share a union of types). */
export type RequestFor<T extends RequestType> = EngineRequest extends infer R
  ? R extends { type: infer U }
    ? T extends U
      ? Omit<R, 'type'> & { type: T }
      : never
    : never
  : never;

/** The success reply of one request type, with `type` narrowed. */
export type ReplyFor<T extends RequestType> = SuccessReply extends infer R
  ? R extends { type: infer U }
    ? T extends U
      ? Omit<R, 'type'> & { type: T }
      : never
    : never
  : never;

/** The state that the adjust-* requests share inside one worker. adjust-begin fills it and adjust-end clears it. */
export interface AdjustSession {
  /** The layer pixels at the begin; never changed by a preview. */
  source: RasterImage | null;
  /** The selection at document size, or null for everything. */
  mask: Mask | null;
  /** Layer position in document px, to read the mask at layer pixels. */
  offset: Point;
  /** A small copy of the source for fast previews of the whole layer, and its scale (proxy px per layer px). */
  proxy: RasterImage | null;
  proxyScale: number;
  /** Free slot for the adjust handlers (caches between previews). */
  cache: Map<string, unknown>;
}

export interface HandlerContext {
  readonly id: number;
  /** Sends a progress event, ratio 0..1. */
  progress(ratio: number): void;
  readonly session: AdjustSession;
}

export interface HandlerResult<T extends RequestType> {
  reply: Omit<ReplyFor<T>, 'id' | 'ok'>;
  transfer?: Transferable[];
}

export type Handler<T extends RequestType> = (request: RequestFor<T>, context: HandlerContext) => HandlerResult<T> | Promise<HandlerResult<T>>;

export function createAdjustSession(): AdjustSession {
  return { source: null, mask: null, offset: { x: 0, y: 0 }, proxy: null, proxyScale: 1, cache: new Map() };
}

export function resetAdjustSession(session: AdjustSession): void {
  session.source = null;
  session.mask = null;
  session.offset = { x: 0, y: 0 };
  session.proxy = null;
  session.proxyScale = 1;
  session.cache.clear();
}
