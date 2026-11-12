import type { ActionId, ActionSource } from '../shortcuts.ts';

export type ActionHandler = (source: ActionSource) => void;

/** The handlers of one feature file: exactly the ids that the file owns. */
export type ActionHandlers<K extends ActionId> = Record<K, ActionHandler>;

/** The ids of each action file. The index checks that the merged maps hold every ActionId. */
export type CoreActionId = Extract<ActionId, `file.${'open' | 'new' | 'close'}` | `edit.${string}` | `tool.${string}` | `view.${string}` | `color.${string}` | `help.${string}`>;
export type ExportActionId = Extract<ActionId, 'file.export'>;
export type GeometryActionId = Extract<ActionId, `image.${string}` | `guides.${string}`>;
export type AdjustActionId = Extract<ActionId, `adjust.${string}`>;
export type SelectActionId = Extract<ActionId, `select.${string}`>;
export type LayersActionId = Extract<ActionId, `layer.${string}`>;
export type PaintActionId = Extract<ActionId, `paint.${string}`>;
/** The text feature has no menu action yet; its map is empty. */
export type TextActionId = never;
