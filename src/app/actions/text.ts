import type { ActionHandlers, TextActionId } from './types.ts';

/** The text feature has no action id of its own: the T key selects the tool through `tool.text`. */
export const textActions: ActionHandlers<TextActionId> = {};
