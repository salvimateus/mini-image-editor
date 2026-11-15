import { cloneRaster } from '../../core/raster.ts';
import { heldCopy, holdCopy, readSystemImage, writeSystemImage } from '../clipboard.ts';
import type { EditorDoc } from '../doc.svelte.ts';
import { t } from '../i18n/index.ts';
import { createRasterLayer } from '../layers.ts';
import * as sfx from '../sfx.ts';
import { app } from '../state.svelte.ts';
import { currentSelection } from '../tools/marquee-rect.ts';
import { cancelTransform } from '../tools/move.ts';
import { erasableLayer, erasePatch, hint, selectionOrHint, selectionPiece, type LayerPiece } from './select.ts';
import type { ActionHandlers, ClipboardActionId } from './types.ts';

/** Keeps the piece for the next paste and also puts it on the system clipboard. */
function hold(piece: LayerPiece): void {
  holdCopy(piece);
  writeSystemImage(piece.image);
}

/** The held copy as a new layer above the active one, at its own place; centered when that place leaves the stage. */
function pasteHeld(doc: EditorDoc): boolean {
  const copy = heldCopy();
  if (!copy) return false;
  const { width, height } = copy.image;
  const fits = copy.x >= 0 && copy.y >= 0 && copy.x + width <= doc.width && copy.y + height <= doc.height;
  const x = fits ? copy.x : Math.round((doc.width - width) / 2);
  const y = fits ? copy.y : Math.round((doc.height - height) / 2);
  cancelTransform(true);
  // A copy of the pixels, so that edits on the new layer never change the held copy.
  doc.addLayer(createRasterLayer(t('doc.pastedLayerName'), cloneRaster(copy.image), x, y), undefined, 'history.paste');
  sfx.play('layer');
  return true;
}

/** Ctrl+C, Ctrl+X and Ctrl+V on the stage. */
export const clipboardActions: ActionHandlers<ClipboardActionId> = {
  'edit.copy': () => {
    const doc = app.doc;
    if (!doc) return;
    const layer = doc.active;
    if (!layer) {
      hint('select.toast.noLayer');
      return;
    }
    cancelTransform(true);
    const piece = selectionPiece(layer, currentSelection(doc));
    if (!piece) {
      hint('select.toast.nothingCopied');
      return;
    }
    hold(piece);
    sfx.play('select');
  },
  'edit.cut': () => {
    const doc = app.doc;
    if (!doc) return;
    const selection = selectionOrHint(doc);
    if (!selection) return;
    cancelTransform(true);
    const layer = doc.active;
    if (!erasableLayer(layer)) {
      hint('select.toast.notRaster');
      return;
    }
    const piece = selectionPiece(layer, selection);
    const patch = piece ? erasePatch(layer, selection) : null;
    if (!piece || !patch) {
      hint('select.toast.nothingCopied');
      return;
    }
    hold(piece);
    doc.commitPatch(layer.id, patch, 'select.history.cut');
    sfx.play('delete');
  },
  'edit.paste': () => {
    const doc = app.doc;
    if (!doc || pasteHeld(doc)) return;
    void readSystemImage().then((files) => {
      if (files.length === 0) {
        app.refuse(t('toast.nothingToPaste'));
        return;
      }
      void app.openFiles(files, 'auto');
    });
  },
};
