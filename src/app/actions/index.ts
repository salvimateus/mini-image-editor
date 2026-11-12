import { keyHud } from '../key-hud.svelte.ts';
import type { ActionId, ActionSource } from '../shortcuts.ts';
import * as sfx from '../sfx.ts';
import { app } from '../state.svelte.ts';
import { adjustActions } from './adjust.ts';
import { coreActions } from './core.ts';
import { exportActions } from './export.ts';
import { geometryActions } from './geometry.ts';
import { layersActions } from './layers.ts';
import { paintActions } from './paint.ts';
import { selectActions } from './select.ts';
import { textActions } from './text.ts';
import type { ActionHandler } from './types.ts';

const HANDLERS: Record<ActionId, ActionHandler> = {
  ...coreActions,
  ...exportActions,
  ...geometryActions,
  ...adjustActions,
  ...selectActions,
  ...layersActions,
  ...paintActions,
  ...textActions,
};

/** The actions that work with no open document. Every other handler can count on `app.doc`. */
const WITHOUT_DOC = new Set<ActionId>(['file.open', 'file.new', 'view.hud', 'view.mute', 'help.shortcuts']);

/** False when the action can do nothing now: the menus and buttons show it as disabled. */
export function actionEnabled(id: ActionId): boolean {
  const doc = app.doc;
  if (!doc) return WITHOUT_DOC.has(id);
  if (id === 'edit.undo') return doc.history.canUndo;
  if (id === 'edit.redo') return doc.history.canRedo;
  return true;
}

/** The on/off state of a toggle action, or null for an action that is not a toggle. */
export function actionChecked(id: ActionId): boolean | null {
  switch (id) {
    case 'view.rulers':
      return app.view.rulers;
    case 'view.guides':
      return app.view.guides;
    case 'view.grid':
      return app.view.grid;
    case 'view.snap':
      return app.view.snap;
    case 'view.avatar':
      return app.view.avatar;
    case 'view.hud':
      return app.view.hud;
    case 'view.mute':
      return !app.muted;
    default:
      return null;
  }
}

/** A key press shows its combo in the KeyHud; a click shows the combo as a hint, so it teaches the shortcut. */
export function runAction(id: ActionId, source: ActionSource): void {
  if (!actionEnabled(id)) {
    // A key for an action that cannot run now still answers, so the user knows the key arrived.
    if (source !== 'key') return;
    if (app.doc && (id === 'edit.undo' || id === 'edit.redo')) HANDLERS[id](source);
    else sfx.play('cancel');
    return;
  }
  if (app.view.hud) keyHud.show(id, source === 'key' ? 'press' : 'hint');
  try {
    HANDLERS[id](source);
  } catch (error) {
    app.fail(error);
  }
}
