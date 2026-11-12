import type { ErrorCode } from '../core/errors.ts';
import type { Mask } from '../core/mask.ts';
import type { EngineReply, EngineRequest, ReplyFor, RequestType, WorkerMessage } from '../core/protocol.ts';
import type { AdjustOp, ExportOptions, Histogram, Point, RasterImage, Rect, ResampleMethod, VignetteParams } from '../core/types.ts';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RequestBody = DistributiveOmit<EngineRequest, 'id'>;
type LaneName = 'fast' | 'codec';

/** Only these calls use "latest wins": a stale call resolves null. */
type LatestKind = 'adjust-preview' | 'vignette' | 'estimate';

export class EngineError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;

  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'EngineError';
    this.code = code;
    this.detail = detail;
  }
}

interface Pending {
  type: RequestType;
  resolve: (reply: EngineReply | null) => void;
  reject: (error: Error) => void;
}

/** One worker instance and its open requests. The worker starts on the first request. */
class Lane {
  private worker: Worker | null = null;
  readonly pending = new Map<number, Pending>();
  readonly name: LaneName;
  private readonly onProgress: (ratio: number) => void;
  private readonly onSettle: () => void;

  constructor(name: LaneName, onProgress: (ratio: number) => void, onSettle: () => void) {
    this.name = name;
    this.onProgress = onProgress;
    this.onSettle = onSettle;
  }

  has(type: RequestType): boolean {
    for (const entry of this.pending.values()) if (entry.type === type) return true;
    return false;
  }

  send(id: number, body: RequestBody, transfer: Transferable[]): Promise<EngineReply | null> {
    const worker = this.ensure();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { type: body.type, resolve, reject });
      try {
        worker.postMessage({ ...body, id } as EngineRequest, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(new EngineError('internal', error instanceof Error ? error.message : String(error)));
      }
    });
  }

  /** Ends the worker on purpose: each open request resolves null. The next request starts a new worker. */
  restart(): void {
    this.worker?.terminate();
    this.worker = null;
    const open = [...this.pending.values()];
    this.pending.clear();
    for (const entry of open) entry.resolve(null);
    this.onSettle();
  }

  dispose(): void {
    this.fail('the engine was closed');
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../core/worker.ts', import.meta.url), { type: 'module', name: `engine-${this.name}` });
    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => this.handle(event.data));
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      this.fail(event.message || 'worker error');
    });
    worker.addEventListener('messageerror', () => this.fail('message could not be read'));
    this.worker = worker;
    return worker;
  }

  private handle(message: WorkerMessage): void {
    if ('type' in message && message.type === 'progress') {
      if (this.pending.has(message.id)) this.onProgress(message.ratio);
      return;
    }
    const reply = message as EngineReply;
    const entry = this.pending.get(reply.id);
    if (!entry) return;
    this.pending.delete(reply.id);
    if (reply.ok) entry.resolve(reply);
    else entry.reject(new EngineError(reply.error, reply.detail));
    this.onSettle();
  }

  /** A dead worker loses its state. Every open request fails with `internal`. */
  private fail(detail: string): void {
    this.worker?.terminate();
    this.worker = null;
    const open = [...this.pending.values()];
    this.pending.clear();
    for (const entry of open) entry.reject(new EngineError('internal', detail));
    this.onSettle();
  }
}

interface DeferredEstimate {
  id: number;
  body: RequestBody;
  transfer: Transferable[];
  resolve: (reply: EngineReply | null) => void;
  reject: (error: Error) => void;
}

function copyImage(image: RasterImage): RasterImage {
  return { width: image.width, height: image.height, data: image.data.slice() };
}

function copyMask(mask: Mask | null): Mask | null {
  if (!mask) return null;
  return { width: mask.width, height: mask.height, data: mask.data.slice(), bounds: mask.bounds ? { ...mask.bounds } : null };
}

function expect<T extends RequestType>(reply: EngineReply, type: T): ReplyFor<T> {
  if (reply.ok && reply.type === type) return reply as unknown as ReplyFor<T>;
  throw new EngineError('internal', `unexpected reply for ${type}`);
}

/**
 * The only door to the workers. Lane `fast` runs decode, adjust, vignette and resize; lane `codec` runs estimate and
 * export. Each image that the caller keeps is copied before the transfer.
 */
export class ImageEngine {
  private nextId = 1;
  private readonly latest: Record<LatestKind, number> = { 'adjust-preview': 0, vignette: 0, estimate: 0 };
  private readonly listeners = new Set<(ratio: number) => void>();
  private deferred: DeferredEstimate | null = null;
  private readonly fast = new Lane('fast', (ratio) => this.emit(ratio), () => {});
  private readonly codec = new Lane('codec', (ratio) => this.emit(ratio), () => this.flushDeferred());

  onProgress(listener: (ratio: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The bytes are transferred: the caller loses them. */
  async decode(bytes: ArrayBuffer, name: string): Promise<{ image: RasterImage; format: string }> {
    const reply = await this.call(this.fast, { type: 'decode', bytes, name }, [bytes]);
    const { image, format } = expect(reply, 'decode');
    return { image, format };
  }

  async adjustBegin(image: RasterImage, mask: Mask | null, offset: Point): Promise<Histogram> {
    const copy = copyImage(image);
    const maskCopy = copyMask(mask);
    const transfer: Transferable[] = [copy.data.buffer];
    if (maskCopy) transfer.push(maskCopy.data.buffer);
    this.latest['adjust-preview'] = this.nextId;
    const reply = await this.call(this.fast, { type: 'adjust-begin', image: copy, mask: maskCopy, offset: { x: offset.x, y: offset.y } }, transfer);
    return expect(reply, 'adjust-begin').histogram;
  }

  async adjustPreview(op: AdjustOp, region: Rect | null): Promise<{ image: RasterImage; rect: Rect; scale: number } | null> {
    const reply = await this.callLatest('adjust-preview', this.fast, { type: 'adjust-preview', op, region });
    if (!reply) return null;
    const { image, rect, scale } = expect(reply, 'adjust-preview');
    return { image, rect, scale };
  }

  async adjustCommit(op: AdjustOp): Promise<RasterImage> {
    this.latest['adjust-preview'] = this.nextId;
    const reply = await this.call(this.fast, { type: 'adjust-commit', op });
    return expect(reply, 'adjust-commit').image;
  }

  async adjustEnd(): Promise<void> {
    this.latest['adjust-preview'] = this.nextId;
    const reply = await this.call(this.fast, { type: 'adjust-end' });
    expect(reply, 'adjust-end');
  }

  async vignette(width: number, height: number, params: VignetteParams): Promise<RasterImage | null> {
    const reply = await this.callLatest('vignette', this.fast, { type: 'vignette', width, height, params });
    return reply ? expect(reply, 'vignette').image : null;
  }

  async resize(image: RasterImage, width: number, height: number, method: ResampleMethod): Promise<RasterImage> {
    const copy = copyImage(image);
    const reply = await this.call(this.fast, { type: 'resize', image: copy, width, height, method }, [copy.data.buffer]);
    return expect(reply, 'resize').image;
  }

  /**
   * Latest wins. A newer estimate ends and restarts the codec worker when an estimate runs there, because the encoders
   * cannot stop. While an export runs, the newest estimate waits for it instead.
   */
  estimate(image: RasterImage, options: ExportOptions): Promise<{ plainBytes: number; bytes: number } | null> {
    const copy = copyImage(image);
    const id = this.nextId++;
    this.latest.estimate = id;
    const body: RequestBody = { type: 'estimate', image: copy, options: cloneOptions(options) };
    const transfer = [copy.data.buffer];
    const sent = new Promise<EngineReply | null>((resolve, reject) => {
      if (this.deferred) {
        this.deferred.resolve(null);
        this.deferred = null;
      }
      if (this.codec.has('export')) {
        this.deferred = { id, body, transfer, resolve, reject };
        return;
      }
      if (this.codec.has('estimate')) this.codec.restart();
      this.codec.send(id, body, transfer).then(resolve, reject);
    });
    return sent.then((reply) => {
      if (!reply || id !== this.latest.estimate) return null;
      const { plainBytes, bytes } = expect(reply, 'estimate');
      return { plainBytes, bytes };
    });
  }

  /**
   * Never waits behind an estimate: a running estimate ends with a restart of the codec worker and resolves null.
   * A running export goes first; while any export runs, a new estimate waits.
   */
  async exportImage(image: RasterImage, options: ExportOptions): Promise<{ bytes: Uint8Array; plainBytes: number }> {
    const copy = copyImage(image);
    if (this.codec.has('estimate') && !this.codec.has('export')) this.codec.restart();
    const reply = await this.call(this.codec, { type: 'export', image: copy, options: cloneOptions(options) }, [copy.data.buffer]);
    const { data, plainBytes } = expect(reply, 'export');
    return { bytes: new Uint8Array(data), plainBytes };
  }

  /** Ends both workers; every open call fails with `internal`. */
  dispose(): void {
    if (this.deferred) {
      this.deferred.resolve(null);
      this.deferred = null;
    }
    this.fast.dispose();
    this.codec.dispose();
  }

  private emit(ratio: number): void {
    for (const listener of this.listeners) listener(ratio);
  }

  private flushDeferred(): void {
    const waiting = this.deferred;
    if (!waiting || this.codec.has('export')) return;
    this.deferred = null;
    if (this.codec.has('estimate')) this.codec.restart();
    this.codec.send(waiting.id, waiting.body, waiting.transfer).then(waiting.resolve, waiting.reject);
  }

  private async call(lane: Lane, body: RequestBody, transfer: Transferable[] = []): Promise<EngineReply> {
    const reply = await lane.send(this.nextId++, body, transfer);
    if (!reply) throw new EngineError('internal', `the ${lane.name} worker restarted`);
    return reply;
  }

  private async callLatest(kind: LatestKind, lane: Lane, body: RequestBody, transfer: Transferable[] = []): Promise<EngineReply | null> {
    const id = this.nextId++;
    this.latest[kind] = id;
    const reply = await lane.send(id, body, transfer);
    return reply && id === this.latest[kind] ? reply : null;
  }
}

function cloneOptions(options: ExportOptions): ExportOptions {
  return { format: options.format, jpegQuality: options.jpegQuality, background: { ...options.background }, icoSizes: [...options.icoSizes] };
}
