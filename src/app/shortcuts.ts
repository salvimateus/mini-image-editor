import { t, type TextKey } from './i18n/index.ts';
import type { ToolId } from './tools/types.ts';

export type ActionId =
  | 'file.open'
  | 'file.new'
  | 'file.export'
  | 'file.close'
  | 'edit.undo'
  | 'edit.redo'
  | `tool.${ToolId}`
  | 'image.canvasSize'
  | 'image.imageSize'
  | 'adjust.hueSaturation'
  | 'adjust.levels'
  | 'adjust.sharpen'
  | 'adjust.vignette'
  | 'select.all'
  | 'select.none'
  | 'select.invert'
  | 'select.erase'
  | 'select.fill'
  | 'layer.new'
  | 'layer.duplicate'
  | 'layer.delete'
  | 'layer.mergeDown'
  | 'layer.transform'
  | 'layer.addImage'
  | 'layer.alignLeft'
  | 'layer.alignCenterH'
  | 'layer.alignRight'
  | 'layer.alignTop'
  | 'layer.alignCenterV'
  | 'layer.alignBottom'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.fit'
  | 'view.actual'
  | 'view.rulers'
  | 'view.guides'
  | 'view.grid'
  | 'view.snap'
  | 'view.avatar'
  | 'view.hud'
  | 'view.mute'
  | 'guides.center'
  | 'guides.thirds'
  | 'guides.clear'
  | 'paint.sizeDown'
  | 'paint.sizeUp'
  | 'paint.hardnessDown'
  | 'paint.hardnessUp'
  | 'color.swap'
  | 'color.reset'
  | 'help.shortcuts';

export type ActionSource = 'key' | 'pointer';

/** `code` for Ctrl+Alt+letter (AltGr on ABNT2 arrives as Ctrl+Alt); `key` for the others, case-insensitive for letters. */
export interface KeyCombo { code?: string; key?: string; ctrl?: boolean; alt?: boolean; shift?: boolean }

export type ShortcutGroup = 'file' | 'edit' | 'tools' | 'image' | 'adjust' | 'select' | 'layer' | 'view';

export interface ShortcutDef { id: ActionId; combos: readonly KeyCombo[]; label: TextKey; group: ShortcutGroup; whileTyping?: boolean }

const key = (value: string, mods: Omit<KeyCombo, 'key' | 'code'> = {}): KeyCombo => ({ key: value, ...mods });
const ctrl = (value: string, mods: Omit<KeyCombo, 'key' | 'code' | 'ctrl'> = {}): KeyCombo => ({ key: value, ctrl: true, ...mods });
const ctrlAlt = (letter: string): KeyCombo => ({ code: `Key${letter.toUpperCase()}`, ctrl: true, alt: true });

/**
 * Every action of the app, also the ones with no key: the menus, tooltips, the hint bar, the KeyHud and the cheat sheet
 * read their labels and keys from here. The first combo is the one that shows.
 */
export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'file.open', combos: [ctrl('o')], label: 'action.file.open', group: 'file' },
  { id: 'file.new', combos: [ctrl('n')], label: 'action.file.new', group: 'file' },
  { id: 'file.export', combos: [ctrl('s')], label: 'action.file.export', group: 'file', whileTyping: true },
  { id: 'file.close', combos: [], label: 'action.file.close', group: 'file' },

  { id: 'edit.undo', combos: [ctrl('z')], label: 'action.edit.undo', group: 'edit' },
  { id: 'edit.redo', combos: [ctrl('z', { shift: true }), ctrl('y')], label: 'action.edit.redo', group: 'edit' },

  { id: 'tool.move', combos: [key('v')], label: 'chrome.tool.move', group: 'tools' },
  { id: 'tool.marquee-rect', combos: [key('m')], label: 'chrome.tool.marquee-rect', group: 'tools' },
  { id: 'tool.marquee-ellipse', combos: [key('m', { shift: true })], label: 'chrome.tool.marquee-ellipse', group: 'tools' },
  { id: 'tool.lasso', combos: [key('l')], label: 'chrome.tool.lasso', group: 'tools' },
  { id: 'tool.wand', combos: [key('w')], label: 'chrome.tool.wand', group: 'tools' },
  { id: 'tool.crop', combos: [key('c')], label: 'chrome.tool.crop', group: 'tools' },
  { id: 'tool.eyedropper', combos: [key('i')], label: 'chrome.tool.eyedropper', group: 'tools' },
  { id: 'tool.brush', combos: [key('b')], label: 'chrome.tool.brush', group: 'tools' },
  { id: 'tool.pencil', combos: [key('p')], label: 'chrome.tool.pencil', group: 'tools' },
  { id: 'tool.eraser', combos: [key('e')], label: 'chrome.tool.eraser', group: 'tools' },
  { id: 'tool.bucket', combos: [key('g')], label: 'chrome.tool.bucket', group: 'tools' },
  { id: 'tool.clone', combos: [key('s')], label: 'chrome.tool.clone', group: 'tools' },
  { id: 'tool.text', combos: [key('t')], label: 'chrome.tool.text', group: 'tools' },
  { id: 'tool.hand', combos: [key('h')], label: 'chrome.tool.hand', group: 'tools' },
  { id: 'tool.zoom', combos: [key('z')], label: 'chrome.tool.zoom', group: 'tools' },
  { id: 'paint.sizeDown', combos: [key('[')], label: 'action.paint.sizeDown', group: 'tools' },
  { id: 'paint.sizeUp', combos: [key(']')], label: 'action.paint.sizeUp', group: 'tools' },
  { id: 'paint.hardnessDown', combos: [key('[', { shift: true })], label: 'action.paint.hardnessDown', group: 'tools' },
  { id: 'paint.hardnessUp', combos: [key(']', { shift: true })], label: 'action.paint.hardnessUp', group: 'tools' },
  { id: 'color.swap', combos: [key('x')], label: 'action.color.swap', group: 'tools' },
  { id: 'color.reset', combos: [key('d')], label: 'action.color.reset', group: 'tools' },

  { id: 'image.canvasSize', combos: [ctrlAlt('c')], label: 'action.image.canvasSize', group: 'image' },
  { id: 'image.imageSize', combos: [ctrlAlt('i')], label: 'action.image.imageSize', group: 'image' },

  { id: 'adjust.hueSaturation', combos: [ctrl('u')], label: 'action.adjust.hueSaturation', group: 'adjust' },
  { id: 'adjust.levels', combos: [ctrl('l')], label: 'action.adjust.levels', group: 'adjust' },
  { id: 'adjust.sharpen', combos: [], label: 'action.adjust.sharpen', group: 'adjust' },
  { id: 'adjust.vignette', combos: [], label: 'action.adjust.vignette', group: 'adjust' },

  { id: 'select.all', combos: [ctrl('a')], label: 'action.select.all', group: 'select' },
  { id: 'select.none', combos: [ctrl('d')], label: 'action.select.none', group: 'select' },
  { id: 'select.invert', combos: [ctrl('i', { shift: true })], label: 'action.select.invert', group: 'select' },
  { id: 'select.erase', combos: [key('Delete')], label: 'action.select.erase', group: 'select' },
  { id: 'select.fill', combos: [key('Backspace', { alt: true })], label: 'action.select.fill', group: 'select' },

  { id: 'layer.new', combos: [ctrl('n', { shift: true })], label: 'action.layer.new', group: 'layer' },
  { id: 'layer.duplicate', combos: [ctrl('j')], label: 'action.layer.duplicate', group: 'layer' },
  { id: 'layer.delete', combos: [], label: 'action.layer.delete', group: 'layer' },
  { id: 'layer.mergeDown', combos: [ctrl('e')], label: 'action.layer.mergeDown', group: 'layer' },
  { id: 'layer.transform', combos: [ctrl('t')], label: 'action.layer.transform', group: 'layer' },
  { id: 'layer.addImage', combos: [], label: 'action.layer.addImage', group: 'layer' },
  { id: 'layer.alignLeft', combos: [], label: 'action.layer.alignLeft', group: 'layer' },
  { id: 'layer.alignCenterH', combos: [], label: 'action.layer.alignCenterH', group: 'layer' },
  { id: 'layer.alignRight', combos: [], label: 'action.layer.alignRight', group: 'layer' },
  { id: 'layer.alignTop', combos: [], label: 'action.layer.alignTop', group: 'layer' },
  { id: 'layer.alignCenterV', combos: [], label: 'action.layer.alignCenterV', group: 'layer' },
  { id: 'layer.alignBottom', combos: [], label: 'action.layer.alignBottom', group: 'layer' },

  { id: 'view.zoomIn', combos: [ctrl('+'), ctrl('=')], label: 'action.view.zoomIn', group: 'view' },
  { id: 'view.zoomOut', combos: [ctrl('-')], label: 'action.view.zoomOut', group: 'view' },
  { id: 'view.fit', combos: [ctrl('0')], label: 'action.view.fit', group: 'view' },
  { id: 'view.actual', combos: [ctrl('1')], label: 'action.view.actual', group: 'view' },
  { id: 'view.rulers', combos: [ctrl('r')], label: 'action.view.rulers', group: 'view' },
  { id: 'view.guides', combos: [ctrl(';')], label: 'action.view.guides', group: 'view' },
  { id: 'view.grid', combos: [ctrl("'")], label: 'action.view.grid', group: 'view' },
  { id: 'view.snap', combos: [ctrl(';', { shift: true })], label: 'action.view.snap', group: 'view' },
  { id: 'view.avatar', combos: [ctrl('o', { shift: true })], label: 'action.view.avatar', group: 'view' },
  { id: 'view.hud', combos: [], label: 'action.view.hud', group: 'view' },
  { id: 'view.mute', combos: [], label: 'action.view.mute', group: 'view' },
  { id: 'guides.center', combos: [], label: 'action.guides.center', group: 'view' },
  { id: 'guides.thirds', combos: [], label: 'action.guides.thirds', group: 'view' },
  { id: 'guides.clear', combos: [], label: 'action.guides.clear', group: 'view' },
  { id: 'help.shortcuts', combos: [key('F1')], label: 'action.help.shortcuts', group: 'view', whileTyping: true },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['file', 'edit', 'tools', 'image', 'adjust', 'select', 'layer', 'view'];

const BY_ID = new Map<ActionId, ShortcutDef>(SHORTCUTS.map((def) => [def.id, def]));

export function shortcutOf(id: ActionId): ShortcutDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown action ${id}`);
  return def;
}

/**
 * The unshifted key of a symbol typed with Shift on US and ABNT2 layouts, so that Shift+[ matches '{' and Ctrl+Shift+;
 * matches ':'.
 */
const UNSHIFTED: Record<string, string> = { '{': '[', '}': ']', ':': ';', '"': "'", _: '-' };

/** The base key of an event: lowercase for letters, unshifted for the symbols above. */
export function baseKey(e: KeyboardEvent): string {
  if (e.shiftKey && e.key in UNSHIFTED) return UNSHIFTED[e.key];
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

function comboMatches(combo: KeyCombo, e: KeyboardEvent): boolean {
  if (Boolean(combo.ctrl) !== (e.ctrlKey || e.metaKey) || Boolean(combo.alt) !== e.altKey) return false;
  if (combo.code !== undefined) return combo.code === e.code && Boolean(combo.shift) === e.shiftKey;
  if (combo.key === undefined) return false;
  // '+' arrives with Shift on the main keys and without it on the numeric keypad.
  if (combo.key === '+') return e.key === '+';
  return baseKey(e) === combo.key.toLowerCase() && Boolean(combo.shift) === e.shiftKey;
}

export function matchShortcut(e: KeyboardEvent): ShortcutDef | null {
  for (const def of SHORTCUTS) {
    if (def.combos.some((combo) => comboMatches(combo, e))) return def;
  }
  return null;
}

const KEY_NAMES: Record<string, string> = {
  ' ': t('key.space'),
  Delete: 'Delete',
  Backspace: 'Backspace',
  Escape: 'Esc',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

/** The keycap text of one key value ('z' → 'Z', 'Escape' → 'Esc'). */
export function keyName(value: string): string {
  if (value in KEY_NAMES) return KEY_NAMES[value];
  return value.length === 1 ? value.toUpperCase() : value;
}

export function comboLabels(combo: KeyCombo): string[] {
  const labels: string[] = [];
  if (combo.ctrl) labels.push('Ctrl');
  if (combo.alt) labels.push('Alt');
  if (combo.shift) labels.push('Shift');
  if (combo.code) labels.push(combo.code.replace(/^(Key|Digit)/, ''));
  else if (combo.key) labels.push(keyName(combo.key));
  return labels;
}

/** The keycaps of the first combo of an action, such as ['Ctrl', 'Alt', 'C']; empty when it has no key. */
export function keyLabels(id: ActionId): string[] {
  const combo = BY_ID.get(id)?.combos[0];
  return combo ? comboLabels(combo) : [];
}

/** The keycap labels that one keyboard event holds down: its modifiers, or the key itself. */
export function eventKeyLabel(e: KeyboardEvent): string | null {
  if (e.key === 'Control' || e.key === 'Meta') return 'Ctrl';
  if (e.key === 'Shift') return 'Shift';
  if (e.key === 'Alt' || e.key === 'AltGraph') return 'Alt';
  // The typed letter, as the shortcuts match it; the physical key only when Ctrl+Alt (AltGr) changes the character.
  if (/^[a-z]$/i.test(e.key)) return e.key.toUpperCase();
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  // The '+' keycap of zoom in sits on the '=' key of US and ABNT2 keyboards.
  if (e.key === '=') return '+';
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (e.key === 'Unidentified' || e.key === 'Dead') return null;
  return keyName(baseKey(e));
}
