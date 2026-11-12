import { t, type TextKey } from '../../app/i18n/index.ts';
import { keyHud } from '../../app/key-hud.svelte.ts';
import { TUNING } from '../../app/tuning/index.ts';

export interface TooltipOptions {
  text: string;
  /** Key labels shown as keycaps after the text, such as ['Ctrl', 'Z']. */
  keys?: readonly string[];
}

const TIP_ID = 'app-tooltip';

/** Mouse tokens show as a text chip, as in Keys.svelte; every other token is a keycap. */
const POINTER_TEXT: Record<string, TextKey> = { Click: 'pointer.click', Drag: 'pointer.drag', Wheel: 'pointer.wheel', RightClick: 'pointer.rightClick' };

/** One floating label for the whole app: only one tooltip shows at a time. */
let tip: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;

function tipElement(): HTMLDivElement {
  if (tip?.isConnected) return tip;
  tip = document.createElement('div');
  tip.id = TIP_ID;
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);
  return tip;
}

function fill(element: HTMLDivElement, options: TooltipOptions): void {
  const text = document.createElement('span');
  text.className = 'tooltip-text';
  text.textContent = options.text;
  const parts: HTMLElement[] = [text];
  if (options.keys && options.keys.length > 0) {
    const group = document.createElement('span');
    group.className = 'keycap-group';
    for (const key of options.keys) {
      if (key in POINTER_TEXT) {
        const chip = document.createElement('span');
        chip.className = 'pointer-chip';
        chip.textContent = t(POINTER_TEXT[key]);
        group.append(chip);
        continue;
      }
      const cap = document.createElement('kbd');
      cap.className = 'keycap';
      cap.textContent = key;
      cap.classList.toggle('is-pressed', keyHud.pressed.has(key));
      group.append(cap);
    }
    parts.push(group);
  }
  element.replaceChildren(...parts);
}

/** Above the element when it fits, else below; always inside the window. */
function place(element: HTMLDivElement, target: HTMLElement): void {
  const { gapPx, edgePx } = TUNING.ui.tooltip;
  const box = target.getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const maxX = window.innerWidth - edgePx - width;
  const x = Math.max(edgePx, Math.min(maxX, box.left + box.width / 2 - width / 2));
  const above = box.top - gapPx - height;
  const below = box.bottom + gapPx;
  const fitsAbove = above >= edgePx;
  const y = fitsAbove ? above : Math.min(below, window.innerHeight - edgePx - height);
  element.dataset.side = fitsAbove ? 'top' : 'bottom';
  element.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
}

function show(target: HTMLElement, options: TooltipOptions): void {
  if (!target.isConnected || options.text.length === 0) return;
  const element = tipElement();
  fill(element, options);
  element.classList.remove('is-visible');
  place(element, target);
  owner = target;
  target.setAttribute('aria-describedby', TIP_ID);
  // A new frame lets the entry transition start from the hidden state.
  requestAnimationFrame(() => {
    if (owner === target) element.classList.add('is-visible');
  });
}

function hide(target: HTMLElement): void {
  if (owner !== target) return;
  owner = null;
  target.removeAttribute('aria-describedby');
  tip?.classList.remove('is-visible');
}

/** The element whose tooltip waits for its delay. */
let pendingNode: HTMLElement | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
let globalsInstalled = false;

function cancelPending(): void {
  clearTimeout(pendingTimer);
  pendingTimer = undefined;
  pendingNode = null;
}

/** The keycaps of the open tooltip follow the keys that the keyboard holds, as every other visible keycap. */
function syncPressed(): void {
  if (!tip || !owner) return;
  for (const cap of tip.querySelectorAll<HTMLElement>('.keycap')) cap.classList.toggle('is-pressed', keyHud.pressed.has(cap.textContent ?? ''));
}

/** The key state changes in the app key handler, after these capture listeners: read it in the next frame. */
function scheduleSync(): void {
  if (owner) requestAnimationFrame(syncPressed);
}

function closeAll(): void {
  cancelPending();
  if (owner) hide(owner);
}

/** One set of window listeners for every tooltip: Escape, the wheel and a window blur close the open one. */
function installGlobals(): void {
  if (globalsInstalled) return;
  globalsInstalled = true;
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') closeAll();
      else scheduleSync();
    },
    true,
  );
  window.addEventListener('keyup', scheduleSync, true);
  window.addEventListener('wheel', closeAll, { passive: true });
  window.addEventListener('blur', closeAll);
}

/** Svelte action: a small floating label with optional keycaps, shown after a short delay on hover or keyboard focus. */
export function tooltip(node: HTMLElement, options: TooltipOptions) {
  let current = options;
  installGlobals();

  const schedule = (): void => {
    cancelPending();
    pendingNode = node;
    pendingTimer = setTimeout(() => {
      pendingNode = null;
      pendingTimer = undefined;
      show(node, current);
    }, TUNING.ui.tooltip.delayMs);
  };

  const close = (): void => {
    if (pendingNode === node) cancelPending();
    hide(node);
  };

  const onPointerEnter = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') schedule();
  };

  const onFocus = (): void => {
    if (node.matches(':focus-visible')) schedule();
  };

  node.addEventListener('pointerenter', onPointerEnter);
  node.addEventListener('pointerleave', close);
  node.addEventListener('pointerdown', close);
  node.addEventListener('focus', onFocus);
  node.addEventListener('blur', close);

  return {
    update(next: TooltipOptions) {
      current = next;
      if (owner === node && tip) {
        if (current.text.length === 0) {
          hide(node);
          return;
        }
        fill(tip, current);
        place(tip, node);
      }
    },
    destroy() {
      close();
      node.removeEventListener('pointerenter', onPointerEnter);
      node.removeEventListener('pointerleave', close);
      node.removeEventListener('pointerdown', close);
      node.removeEventListener('focus', onFocus);
      node.removeEventListener('blur', close);
    },
  };
}
