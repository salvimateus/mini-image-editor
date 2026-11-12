import { t } from './i18n/index.ts';
import { eventKeyLabel, keyLabels, shortcutOf, type ActionId } from './shortcuts.ts';
import { TUNING } from './tuning/index.ts';

export type HudMode = 'press' | 'hint';

export interface HudItem { serial: number; id: ActionId; keys: readonly string[]; label: string; mode: HudMode }

/** The keys held now and the last combo, for the KeyHud and for each visible keycap. */
class KeyHudState {
  /** The last shown combo; null when the HUD is empty. */
  item = $state.raw<HudItem | null>(null);
  /** Key labels that the keyboard holds now, such as 'Ctrl' and 'Z'. */
  pressed = $state.raw<ReadonlySet<string>>(new Set());

  private serial = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Shows the combo of the action; nothing for an action with no key. */
  show(id: ActionId, mode: HudMode): void {
    const keys = keyLabels(id);
    if (keys.length === 0) return;
    this.serial += 1;
    this.item = { serial: this.serial, id, keys, label: t(shortcutOf(id).label), mode };
    clearTimeout(this.timer);
    const ms = mode === 'hint' ? TUNING.ui.keyHud.hintMs : TUNING.ui.keyHud.pressMs;
    const serial = this.serial;
    this.timer = setTimeout(() => {
      if (this.item?.serial === serial) this.item = null;
    }, ms);
  }

  keyDown(e: KeyboardEvent): void {
    const label = eventKeyLabel(e);
    if (!label || this.pressed.has(label)) return;
    this.pressed = new Set([...this.pressed, label]);
  }

  keyUp(e: KeyboardEvent): void {
    const label = eventKeyLabel(e);
    const next = new Set(this.pressed);
    if (label) next.delete(label);
    // A released modifier can hide the keyup of the main key (Ctrl+Z on some layouts): keep the set honest.
    if (!e.ctrlKey && !e.metaKey) next.delete('Ctrl');
    if (!e.shiftKey) next.delete('Shift');
    if (!e.altKey) next.delete('Alt');
    if (next.size !== this.pressed.size) this.pressed = next;
  }

  /** The window lost the focus: no key is held any more. */
  reset(): void {
    if (this.pressed.size > 0) this.pressed = new Set();
  }
}

export const keyHud = new KeyHudState();
