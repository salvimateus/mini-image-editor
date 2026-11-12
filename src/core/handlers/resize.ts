import type { Handler } from '../protocol.ts';
import { resizeRaster } from '../resample.ts';
import { checkLimits } from './decode.ts';

export const resize: Handler<'resize'> = (request, context) => {
  checkLimits({ width: request.width, height: request.height });
  context.progress(0);
  const image = resizeRaster(request.image, request.width, request.height, request.method, {
    onProgress: (ratio) => context.progress(ratio),
  });
  return { reply: { type: 'resize', image }, transfer: [image.data.buffer] };
};
