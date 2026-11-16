import { CoreError } from '../errors.ts';
import { inpaint as fillHole } from '../inpaint/index.ts';
import type { Handler } from '../protocol.ts';

export const inpaint: Handler<'inpaint'> = (request, context) => {
  const { image, hole, strength } = request;
  if (!(image?.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) {
    throw new CoreError('internal', 'inpaint needs an RGBA image.');
  }
  if (!(hole instanceof Uint8Array) || hole.length !== image.width * image.height) {
    throw new CoreError('internal', 'The inpaint hole does not match the image size.');
  }
  if (!Number.isFinite(strength)) throw new CoreError('internal', 'The inpaint strength is not a number.');
  context.progress(0);
  const result = fillHole(image, hole, strength, { onProgress: context.progress });
  if (!result) return { reply: { type: 'inpaint', image: null, rect: { x: 0, y: 0, w: 0, h: 0 } } };
  return { reply: { type: 'inpaint', image: result.image, rect: result.rect }, transfer: [result.image.data.buffer] };
};
