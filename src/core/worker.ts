import { CoreError, errorCode, errorMessage } from './errors.ts';
import { HANDLERS } from './handlers/index.ts';
import { createAdjustSession, type EngineReply, type EngineRequest, type Handler, type HandlerContext, type RequestType, type WorkerMessage } from './protocol.ts';

/** The worker global, typed by hand because the DOM lib types `self` as Window. */
interface WorkerScope {
  postMessage(message: WorkerMessage, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

// One module serves both lanes; only the fast lane uses the adjust session.
const session = createAdjustSession();

function post(message: WorkerMessage, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

async function handle(request: EngineRequest): Promise<void> {
  const { id } = request;
  const handler = (HANDLERS as Record<string, Handler<RequestType> | undefined>)[request?.type];
  if (!handler) throw new CoreError('internal', `Unknown request type ${String((request as { type?: unknown }).type)}.`);
  const context: HandlerContext = {
    id,
    session,
    progress: (ratio) => post({ id, type: 'progress', ratio: Math.min(1, Math.max(0, ratio)) }),
  };
  const { reply, transfer } = await handler(request as Parameters<typeof handler>[0], context);
  post({ ...reply, id, ok: true } as EngineReply, transfer ?? []);
}

// Requests run one at a time, in arrival order, so a reply never sees the state of a later request.
let queue: Promise<void> = Promise.resolve();

scope.onmessage = (event: MessageEvent<EngineRequest>) => {
  const request = event.data;
  const id = typeof request?.id === 'number' ? request.id : -1;
  queue = queue.then(() =>
    handle(request).catch((error: unknown) => {
      post({ id, ok: false, error: errorCode(error), detail: errorMessage(error) });
    }),
  );
};
