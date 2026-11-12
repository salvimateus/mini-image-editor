import { CoreError } from '../../core/errors.ts';
import { PARAMS } from '../../core/params/index.ts';
import type { Rect, Rgba } from '../../core/types.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import { prepareGenerators } from '../generators.ts';
import { guidePreset, mergeGuides } from '../guides.ts';
import { t, type TextKey } from '../i18n/index.ts';
import * as sfx from '../sfx.ts';
import { app } from '../state.svelte.ts';
import type { ActionHandler, ActionHandlers, GeometryActionId } from './types.ts';

/** The fill of the new area of a crop or a canvas size. */
export type StageFill = 'transparent' | 'white' | 'black' | 'fg' | 'bg';

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };

/** The color of a fill choice now (the foreground and background colors can change); null = transparent. */
export function stageFillColor(fill: StageFill): Rgba | null {
  switch (fill) {
    case 'white':
      return WHITE;
    case 'black':
      return BLACK;
    case 'fg':
      return { ...app.fg };
    case 'bg':
      return { ...app.bg };
    default:
      return null;
  }
}

/** The reason why a stage size is not valid, or null when it is. */
export function stageSizeProblem(width: number, height: number): string | null {
  const { maxSide, maxPixels } = PARAMS.limits;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return t('geometry.invalid.small');
  if (width > maxSide || height > maxSide) return t('geometry.invalid.side', { max: maxSide });
  if (width * height > maxPixels) {
    return t('geometry.invalid.pixels', { mp: Math.round((width * height) / 1e6), max: Math.round(maxPixels / 1e6) });
  }
  return null;
}

/**
 * The new stage is `rect` of the old stage (crop, canvas size): the generated layers are made again for the new size
 * first, then one undo step changes the stage and puts them in. False when nothing changed.
 */
export async function applyStageRect(doc: EditorDoc, rect: Rect, fill: Rgba | null, label: TextKey): Promise<boolean> {
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
  if (r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height) return false;
  const problem = stageSizeProblem(r.w, r.h);
  if (problem) throw new CoreError('too-large', problem);
  const putGenerated = await app.track(prepareGenerators(doc, r.w, r.h));
  if (app.doc !== doc) return false;
  doc.batch(label, () => {
    doc.setStage(r, fill, label);
    putGenerated();
  });
  return true;
}

function preset(kind: 'center' | 'thirds'): ActionHandler {
  return () => {
    const doc = app.doc;
    if (!doc) return;
    const next = mergeGuides(doc.guides, guidePreset(kind, doc.width, doc.height, () => doc.nextGuideId()));
    if (!app.view.guides) app.setView({ guides: true });
    if (next.length === doc.guides.length) {
      app.refuse(t('geometry.guides.already'));
      return;
    }
    doc.setGuides(next, kind === 'center' ? 'geometry.history.guidesCenter' : 'geometry.history.guidesThirds');
    sfx.play('snap');
  };
}

/** Canvas size, image size and the guide presets. */
export const geometryActions: ActionHandlers<GeometryActionId> = {
  'image.canvasSize': () => app.openDialog('canvas-size'),
  'image.imageSize': () => app.openDialog('image-size'),
  'guides.center': preset('center'),
  'guides.thirds': preset('thirds'),
  'guides.clear': () => {
    const doc = app.doc;
    if (!doc) return;
    if (doc.guides.length === 0) {
      app.refuse(t('geometry.guides.none'));
      return;
    }
    doc.setGuides([], 'geometry.history.guidesClear');
    sfx.play('delete');
  },
};
