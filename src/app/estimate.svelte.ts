import { untrack } from 'svelte';
import { PARAMS } from '../core/params/index.ts';
import type { ExportFormat, ExportOptions, RasterImage } from '../core/types.ts';
import type { EditorDoc } from './doc.svelte.ts';
import { app } from './state.svelte.ts';
import { TUNING } from './tuning/index.ts';

/** The options of an export in the last format, as the dialog would make them. */
export function exportOptions(format: ExportOptions['format'], jpegQuality: number): ExportOptions {
  return { format, jpegQuality, background: { ...TUNING.export.jpegBackground }, icoSizes: [...PARAMS.export.icoSizes] };
}

let token = 0;
/** A step of this counter runs the estimate again: an export ended the last one before it replied. */
let retryTick = $state(0);

/**
 * The live export weight of the status bar. Each change of the document or of the export settings marks it pending,
 * and the estimate runs after a quiet time, in two phases: the plain size first, as an upper limit, then the optimized
 * size. While the export dialog is open it waits, and it runs again when the dialog closes. A stale reply changes
 * nothing.
 */
$effect.root(() => {
  $effect(() => {
    const doc = app.doc;
    const format = app.lastFormat;
    const quality = app.jpegQuality;
    const exporting = app.dialog === 'export';
    void retryTick;
    if (!doc) {
      token++;
      app.setWeight({ bytes: null, pending: false, upper: false });
      return;
    }
    // Read for the dependency: each pixel or structure change restarts the wait.
    void doc.version;
    const mine = ++token;
    untrack(() => app.setWeight({ bytes: app.weight.bytes, pending: true, upper: app.weight.upper }));
    if (exporting) return;
    const timer = setTimeout(() => void run(doc, format, quality, mine), TUNING.export.estimateDelayMs);
    return () => clearTimeout(timer);
  });
});

async function run(doc: EditorDoc, format: ExportFormat, quality: number, mine: number): Promise<void> {
  if (mine !== token || app.doc !== doc) return;
  const options = exportOptions(format, quality);
  // One flatten for both phases; the engine copies it for each request, so the reference goes before the long wait.
  let image: RasterImage | null = doc.flatten(format === 'jpeg' ? TUNING.export.jpegBackground : undefined);
  try {
    if (image.width * image.height > TUNING.export.quickFromPixels) {
      const quick = await app.engine.estimate(image, options, true);
      if (mine !== token) return;
      if (quick === null) {
        retryTick++;
        return;
      }
      app.setWeight({ bytes: quick.plainBytes, pending: true, upper: true });
    }
    const optimized = app.engine.estimate(image, options);
    image = null;
    const result = await optimized;
    if (mine !== token) return;
    if (result === null) {
      retryTick++;
      return;
    }
    app.setWeight({ bytes: result.bytes, pending: false, upper: false });
  } catch {
    if (mine === token) app.setWeight({ bytes: null, pending: false, upper: false });
  }
}
