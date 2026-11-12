import type { Handler, RequestType } from '../protocol.ts';
import { adjustBegin, adjustCommit, adjustEnd, adjustPreview, vignette } from './adjust.ts';
import { decode } from './decode.ts';
import { estimate, exportImage } from './export.ts';
import { resize } from './resize.ts';

/** One handler for each request type. */
export const HANDLERS: { [T in RequestType]: Handler<T> } = {
  decode,
  'adjust-begin': adjustBegin,
  'adjust-preview': adjustPreview,
  'adjust-commit': adjustCommit,
  'adjust-end': adjustEnd,
  vignette,
  resize,
  estimate,
  export: exportImage,
};
