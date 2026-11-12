import '../estimate.svelte.ts';
import { app } from '../state.svelte.ts';
import type { ActionHandlers, ExportActionId } from './types.ts';

export const exportActions: ActionHandlers<ExportActionId> = {
  'file.export': () => app.openDialog('export'),
};
