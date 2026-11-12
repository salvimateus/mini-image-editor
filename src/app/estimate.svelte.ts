import { untrack } from 'svelte';
import { PARAMS } from '../core/params/index.ts';
import type { ExportOptions } from '../core/types.ts';
import { app } from './state.svelte.ts';
import { TUNING } from './tuning/index.ts';

/** The options of an export in the last format, as the dialog would make them. */
export function exportOptions(format: ExportOptions['format'], jpegQuality: number): ExportOptions {
  return { format, jpegQuality, background: { ...TUNING.export.jpegBackground }, icoSizes: [...PARAMS.export.icoSizes] };
}

let token = 0;

/**
 * The live export weight of the status bar: each change of the document or of the export settings marks it pending,
 * and the estimate runs after a quiet time. A stale reply changes nothing.
 */
$effect.root(() => {
  $effect(() => {
    const doc = app.doc;
    const format = app.lastFormat;
    const quality = app.jpegQuality;
    if (!doc) {
      token++;
      app.setWeight({ bytes: null, pending: false });
      return;
    }
    // Read for the dependency: each pixel or structure change restarts the wait.
    void doc.version;
    const mine = ++token;
    untrack(() => app.setWeight({ bytes: app.weight.bytes, pending: true }));
    const timer = setTimeout(() => {
      if (mine !== token || app.doc !== doc) return;
      const image = doc.flatten(format === 'jpeg' ? TUNING.export.jpegBackground : undefined);
      app.engine.estimate(image, exportOptions(format, quality)).then(
        (result) => {
          if (result === null || mine !== token) return;
          app.setWeight({ bytes: result.bytes, pending: false });
        },
        () => {
          if (mine === token) app.setWeight({ bytes: null, pending: false });
        },
      );
    }, TUNING.export.estimateDelayMs);
    return () => clearTimeout(timer);
  });
});
