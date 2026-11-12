import { PARAMS } from '../core/params/index.ts';
import type { TextKey } from './i18n/index.ts';
import { TUNING } from './tuning/index.ts';

export interface HistoryEntry {
  readonly label: TextKey;
  /** The memory that the entry keeps (pixel copies), for the history budget. */
  readonly bytes: number;
  /** Two entries with one key that come inside TUNING.ui.coalesceMs merge into one undo step. */
  readonly coalesce?: string;
  /** A change that is not part of the exported image (selection, guides): it does not make the document dirty. */
  readonly neutral?: boolean;
  undo(): void;
  redo(): void;
}

/** One undo step: one entry, or several merged entries, applied in order. */
class Step implements HistoryEntry {
  readonly parts: HistoryEntry[];
  readonly serial: number;
  /** The serial of the newest step at or below this one that changed the image; a neutral step keeps the one below. */
  readonly content: number;
  readonly at: number;

  constructor(parts: HistoryEntry[], serial: number, below: number, at: number) {
    this.parts = parts;
    this.serial = serial;
    this.content = parts.every((part) => part.neutral) ? below : serial;
    this.at = at;
  }

  get label(): TextKey {
    return this.parts[this.parts.length - 1].label;
  }

  get bytes(): number {
    let total = 0;
    for (const part of this.parts) total += part.bytes;
    return total;
  }

  get coalesce(): string | undefined {
    return this.parts[this.parts.length - 1].coalesce;
  }

  get neutral(): boolean {
    return this.serial !== this.content;
  }

  undo(): void {
    for (let i = this.parts.length - 1; i >= 0; i--) this.parts[i].undo();
  }

  redo(): void {
    for (const part of this.parts) part.redo();
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Undo and redo stacks with a byte budget and a step limit (PARAMS.history). `dirty` compares the image state of the
 * current step with the one of the last markClean; neutral steps do not count.
 */
export class History {
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private serial = 0;
  /** The content serial of the state below the oldest undo step. */
  private base = 0;
  private totalBytes = 0;
  #state = $state({ undo: 0, redo: 0, top: 0, clean: 0, undoLabel: null as TextKey | null, redoLabel: null as TextKey | null });

  get canUndo(): boolean {
    return this.#state.undo > 0;
  }

  get canRedo(): boolean {
    return this.#state.redo > 0;
  }

  get dirty(): boolean {
    return this.#state.top !== this.#state.clean;
  }

  /** The label of the step that undo would revert, or null. */
  get undoLabel(): TextKey | null {
    return this.#state.undoLabel;
  }

  get redoLabel(): TextKey | null {
    return this.#state.redoLabel;
  }

  /** Bytes that the undo and redo steps keep. */
  get bytes(): number {
    return this.totalBytes;
  }

  /** Clears redo. Merges into the newest step when the coalesce key is equal and the step is recent. */
  push(entry: HistoryEntry): void {
    for (const step of this.redoStack) this.totalBytes -= step.bytes;
    this.redoStack = [];
    const at = now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && entry.coalesce !== undefined && top.coalesce === entry.coalesce && at - top.at <= TUNING.ui.coalesceMs) {
      // A new serial: the merged step is a new state, also when the old one was the clean state.
      const below = this.undoStack.length > 1 ? this.undoStack[this.undoStack.length - 2].content : this.base;
      this.undoStack[this.undoStack.length - 1] = new Step([...top.parts, entry], ++this.serial, below, at);
    } else {
      this.undoStack.push(new Step([entry], ++this.serial, this.topSerial(), at));
    }
    this.totalBytes += entry.bytes;
    this.trim();
    this.sync();
  }

  undo(): HistoryEntry | null {
    const step = this.undoStack.pop();
    if (!step) return null;
    this.redoStack.push(step);
    step.undo();
    this.sync();
    return step;
  }

  redo(): HistoryEntry | null {
    const step = this.redoStack.pop();
    if (!step) return null;
    this.undoStack.push(step);
    step.redo();
    this.sync();
    return step;
  }

  /** The current state is the saved state. */
  markClean(): void {
    this.#state.clean = this.topSerial();
  }

  /** Drops every step. A dirty document stays dirty. */
  clear(): void {
    const wasDirty = this.dirty;
    this.undoStack = [];
    this.redoStack = [];
    this.totalBytes = 0;
    this.base = ++this.serial;
    this.#state.clean = wasDirty ? -1 : this.base;
    this.sync();
  }

  private topSerial(): number {
    const top = this.undoStack[this.undoStack.length - 1];
    return top ? top.content : this.base;
  }

  /** Drops the oldest steps above the limits; the newest step always stays. */
  private trim(): void {
    const { budgetBytes, maxSteps } = PARAMS.history;
    while (this.undoStack.length > 1 && (this.undoStack.length > maxSteps || this.totalBytes > budgetBytes)) {
      const dropped = this.undoStack.shift() as Step;
      this.totalBytes -= dropped.bytes;
      this.base = dropped.content;
    }
  }

  private sync(): void {
    const s = this.#state;
    s.undo = this.undoStack.length;
    s.redo = this.redoStack.length;
    s.top = this.topSerial();
    s.undoLabel = this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : null;
    s.redoLabel = this.redoStack.length ? this.redoStack[this.redoStack.length - 1].label : null;
  }
}
