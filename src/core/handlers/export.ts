import { encodeImage } from '../encode/index.ts';
import { CoreError } from '../errors.ts';
import { PARAMS } from '../params/index.ts';
import type { Handler } from '../protocol.ts';

/** A buffer that holds exactly the file, so the transfer sends no extra bytes. */
function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) return bytes.buffer;
  return bytes.slice().buffer as ArrayBuffer;
}

/** Above the pixel limit the estimate makes only the plain file, and both numbers are its size. */
export const estimate: Handler<'estimate'> = async (request, context) => {
  const { image, options } = request;
  const optimize = options.format === 'ico' || image.width * image.height <= PARAMS.export.estimateFullMaxPixels;
  const file = await encodeImage(image, options, { optimize, progress: context.progress });
  return { reply: { type: 'estimate', plainBytes: file.plainSize, bytes: file.bytes?.length ?? file.plainSize } };
};

export const exportImage: Handler<'export'> = async (request, context) => {
  const file = await encodeImage(request.image, request.options, { optimize: true, progress: context.progress });
  if (!file.bytes) throw new CoreError('internal', 'The encoder made no file.');
  const data = exactBuffer(file.bytes);
  return { reply: { type: 'export', data, plainBytes: file.plainSize }, transfer: [data] };
};
