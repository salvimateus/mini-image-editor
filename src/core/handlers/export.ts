import { encodeImage } from '../encode/index.ts';
import { CoreError } from '../errors.ts';
import type { Handler } from '../protocol.ts';

/** A buffer that holds exactly the file, so the transfer sends no extra bytes. */
function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) return bytes.buffer;
  return bytes.slice().buffer as ArrayBuffer;
}

/** A quick estimate makes only the plain size, and both numbers are that size; else the optimized size too. */
export const estimate: Handler<'estimate'> = async (request, context) => {
  const file = await encodeImage(request.image, request.options, { optimize: request.quick !== true, progress: context.progress });
  return { reply: { type: 'estimate', plainBytes: file.plainSize, bytes: file.bytes?.length ?? file.plainSize } };
};

export const exportImage: Handler<'export'> = async (request, context) => {
  const file = await encodeImage(request.image, request.options, { optimize: true, progress: context.progress });
  if (!file.bytes) throw new CoreError('internal', 'The encoder made no file.');
  const data = exactBuffer(file.bytes);
  return { reply: { type: 'export', data, plainBytes: file.plainSize }, transfer: [data] };
};
