import type { ToolId } from '../tools/types.ts';
import { app } from '../state.svelte.ts';
import * as sfx from '../sfx.ts';
import { TUNING } from '../tuning/index.ts';
import { pickImageFiles } from './pick-files.ts';
import type { ActionHandler, ActionHandlers, CoreActionId } from './types.ts';

function tool(id: ToolId): ActionHandler {
  return () => app.setTool(id);
}

function toggle(flag: 'rulers' | 'guides' | 'grid' | 'snap' | 'avatar' | 'hud'): ActionHandler {
  return () => {
    app.setView({ [flag]: !app.view[flag] });
    sfx.play('tick');
  };
}

function zoom(run: () => void): ActionHandler {
  return () => {
    run();
    sfx.play('tick');
  };
}

/** The actions of the chrome: files, history, tools, view and colors. */
export const coreActions: ActionHandlers<CoreActionId> = {
  'file.open': () => {
    void pickImageFiles().then((files) => {
      if (files.length > 0) void app.openFiles(files, 'document');
    });
  },
  'file.new': () => app.openDialog('new-image'),
  'file.close': () => void app.closeDocument(),
  'edit.undo': () => app.undo(),
  'edit.redo': () => app.redo(),

  'tool.move': tool('move'),
  'tool.marquee-rect': tool('marquee-rect'),
  'tool.marquee-ellipse': tool('marquee-ellipse'),
  'tool.lasso': tool('lasso'),
  'tool.wand': tool('wand'),
  'tool.crop': tool('crop'),
  'tool.eyedropper': tool('eyedropper'),
  'tool.brush': tool('brush'),
  'tool.pencil': tool('pencil'),
  'tool.eraser': tool('eraser'),
  'tool.bucket': tool('bucket'),
  'tool.clone': tool('clone'),
  'tool.text': tool('text'),
  'tool.shape': tool('shape'),
  'tool.step': tool('step'),
  'tool.hand': tool('hand'),
  'tool.zoom': tool('zoom'),

  'view.zoomIn': zoom(() => app.stage?.zoomBy(TUNING.stage.zoom.step)),
  'view.zoomOut': zoom(() => app.stage?.zoomBy(1 / TUNING.stage.zoom.step)),
  'view.fit': zoom(() => app.stage?.fitView()),
  'view.actual': zoom(() => app.stage?.zoomTo(1)),
  'view.rulers': toggle('rulers'),
  'view.guides': toggle('guides'),
  'view.grid': toggle('grid'),
  'view.snap': toggle('snap'),
  'view.avatar': toggle('avatar'),
  'view.hud': toggle('hud'),
  'view.mute': () => {
    // The tick plays before a mute and after an unmute, so both directions are heard.
    if (!app.muted) sfx.play('tick');
    app.toggleMute();
    if (!app.muted) sfx.play('tick');
  },

  'color.swap': () => app.swapColors(),
  'color.reset': () => app.resetColors(),
  'help.shortcuts': () => app.openDialog(app.dialog === 'shortcuts' ? 'none' : 'shortcuts'),
};
