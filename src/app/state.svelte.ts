import { CoreError, errorCode } from '../core/errors.ts';
import { FORMAT_INFO } from '../core/formats.ts';
import { PARAMS } from '../core/params/index.ts';
import { createRaster } from '../core/raster.ts';
import type { ExportFormat, RasterImage, Rgba } from '../core/types.ts';
import type { StageApi, StagePointer } from '../ui/stage-renderer.ts';
import { EditorDoc } from './doc.svelte.ts';
import { ImageEngine } from './engine.ts';
import { cleanBaseName } from './file-name.ts';
import { t } from './i18n/index.ts';
import { createRasterLayer } from './layers.ts';
import * as sfx from './sfx.ts';
import { readStored, writeStored } from './storage.ts';
import { TOOLS } from './tools/index.ts';
import type { ToolId } from './tools/types.ts';
import { TUNING } from './tuning/index.ts';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastAction {
  label: string;
  run(): void;
}

export interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
  action: ToastAction | null;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

/** size in px; hardness and opacity 0..1. */
export interface BrushSettings { size: number; hardness: number; opacity: number }
export type BrushToolId = 'brush' | 'pencil' | 'eraser' | 'clone';
export type PanelId = 'none' | 'hue-saturation' | 'levels' | 'sharpen' | 'vignette' | 'text' | 'frame';
export type DialogId = 'none' | 'new-image' | 'canvas-size' | 'image-size' | 'export' | 'shortcuts';
export interface ViewFlags { rulers: boolean; guides: boolean; grid: boolean; snap: boolean; avatar: boolean; hud: boolean }
export interface BucketSettings { tolerance: number; contiguous: boolean }
export interface CropRequest { ratioW: number; ratioH: number; mode: 'crop' | 'expand' }
/** upper: `bytes` is the size before optimization, and the optimized size is still in work. */
export interface WeightState { bytes: number | null; pending: boolean; upper?: boolean }

const BRUSH_TOOLS: readonly BrushToolId[] = ['brush', 'pencil', 'eraser', 'clone'];
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readJson(key: string): Record<string, unknown> | null {
  const text = readStored(key);
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function cleanBrush(value: Partial<BrushSettings>, base: BrushSettings): BrushSettings {
  const { min, max } = TUNING.ui.brushSize;
  return {
    size: Math.round(clamp(finite(value.size, base.size), min, max)),
    hardness: clamp(finite(value.hardness, base.hardness), 0, 1),
    opacity: clamp(finite(value.opacity, base.opacity), 0.01, 1),
  };
}

function loadBrushes(): Record<BrushToolId, BrushSettings> {
  const stored = readJson('brush');
  const out = {} as Record<BrushToolId, BrushSettings>;
  for (const id of BRUSH_TOOLS) {
    const base = TUNING.ui.brushDefaults[id];
    const entry = stored?.[id];
    out[id] = cleanBrush(entry && typeof entry === 'object' ? (entry as Partial<BrushSettings>) : {}, base);
  }
  return out;
}

function cleanBucket(value: Partial<BucketSettings>, base: BucketSettings): BucketSettings {
  return {
    tolerance: Math.round(clamp(finite(value.tolerance, base.tolerance), 0, 255)),
    contiguous: typeof value.contiguous === 'boolean' ? value.contiguous : base.contiguous,
  };
}

function loadView(): ViewFlags {
  const stored = readJson('view') ?? {};
  const out = { ...TUNING.ui.viewDefaults } as ViewFlags;
  for (const key of Object.keys(out) as (keyof ViewFlags)[]) {
    if (typeof stored[key] === 'boolean') out[key] = stored[key] as boolean;
  }
  return out;
}

function isFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && value in FORMAT_INFO;
}

function cleanQuality(value: unknown, fallback: number): number {
  return Math.round(clamp(finite(value, fallback), 1, 100));
}

function isRgba(value: unknown): value is Rgba {
  if (!value || typeof value !== 'object') return false;
  const color = value as Record<string, unknown>;
  return ['r', 'g', 'b', 'a'].every((key) => typeof color[key] === 'number' && Number.isFinite(color[key]));
}

function opaque(color: Rgba): Rgba {
  return { r: clamp(Math.round(color.r), 0, 255), g: clamp(Math.round(color.g), 0, 255), b: clamp(Math.round(color.b), 0, 255), a: 255 };
}

function sameColor(a: Rgba, b: Rgba): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

function loadRecent(): Rgba[] {
  const text = readStored('colors');
  if (!text) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter(isRgba).map(opaque).slice(0, TUNING.ui.recentColors) : [];
  } catch {
    return [];
  }
}

/** The document name of a file: the file name without its extension. */
function docName(file: File): string {
  return cleanBaseName(file.name.replace(/\.[^.]+$/, '')) || t('chrome.untitled');
}

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/x-ms-bmp']);
const ACCEPTED_EXTENSIONS = /\.(png|jpe?g|jfif|webp|gif|bmp)$/i;

/** The value of the `accept` attribute of every image file input. */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,.png,.jpg,.jpeg,.webp,.gif,.bmp';

/** A file that the app tries to open as an image: a known type, or a known extension when the type is empty. */
export function isImageFile(file: File): boolean {
  return ACCEPTED_TYPES.has(file.type) || (file.type === '' && ACCEPTED_EXTENSIONS.test(file.name));
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

class AppState {
  toasts = $state<ToastItem[]>([]);
  confirmRequest = $state.raw<ConfirmRequest | null>(null);
  muted = $state(sfx.isMuted());
  /** A file drag is over the window. */
  dragActive = $state(false);
  busyCount = $state(0);
  /** True when tracked work lasts longer than the progress delay. */
  showProgress = $state(false);
  /** The progress of the tracked work, 0..1, or null when it is not known. */
  progress = $state<number | null>(null);

  /** The open document; null shows the welcome screen. */
  doc = $state.raw<EditorDoc | null>(null);
  readonly engine = new ImageEngine();
  tool = $state<ToolId>('move');
  fg = $state.raw<Rgba>(BLACK);
  bg = $state.raw<Rgba>(WHITE);
  recentColors = $state.raw<readonly Rgba[]>(loadRecent());
  brush = $state.raw<Record<BrushToolId, BrushSettings>>(loadBrushes());
  bucket = $state.raw<BucketSettings>(cleanBucket(readJson('bucket') ?? {}, TUNING.ui.bucketDefaults));
  view = $state.raw<ViewFlags>(loadView());
  panel = $state<PanelId>('none');
  dialog = $state<DialogId>('none');
  lastFormat = $state<ExportFormat>('png');
  jpegQuality = $state<number>(TUNING.ui.exportDefaults.jpegQuality);
  weight = $state.raw<WeightState>({ bytes: null, pending: false });
  /** 1 = 100%; EditorStage writes it. */
  zoom = $state(1);
  /** EditorStage adds 1 on each zoom, pan or resize; floats read it to move. */
  viewTick = $state(0);
  stage = $state.raw<StageApi | null>(null);
  stagePick = $state.raw<((p: StagePointer) => void) | null>(null);
  cropRequest = $state.raw<CropRequest | null>(null);

  private toastId = 0;
  private historyToast = 0;

  constructor() {
    const stored = readJson('export');
    const defaults = TUNING.ui.exportDefaults;
    this.lastFormat = isFormat(stored?.format) ? stored.format : defaults.format;
    this.jpegQuality = cleanQuality(stored?.jpegQuality, defaults.jpegQuality);
    this.engine.onProgress((ratio) => {
      if (this.busyCount > 0) this.progress = ratio;
    });
  }

  get busy(): boolean {
    return this.busyCount > 0;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    sfx.setMuted(this.muted);
  }

  /** Returns the toast id, for `dismissToast`. */
  toast(text: string, kind: ToastKind = 'info', action?: ToastAction, ms?: number): number {
    const id = ++this.toastId;
    this.toasts = [...this.toasts, { id, text, kind, action: action ?? null }].slice(-TUNING.ui.maxToasts);
    const life = ms ?? (action ? TUNING.ui.toastActionMs : kind === 'error' ? TUNING.ui.toastErrorMs : TUNING.ui.toastMs);
    setTimeout(() => this.dismissToast(id), life);
    return id;
  }

  dismissToast(id: number): void {
    this.toasts = this.toasts.filter((toast) => toast.id !== id);
  }

  /** A new request resolves the open one with false. */
  confirm(title: string, body: string, confirmLabel: string): Promise<boolean> {
    this.confirmRequest?.resolve(false);
    return new Promise((resolve) => {
      const request: ConfirmRequest = {
        title,
        body,
        confirmLabel,
        resolve: (ok) => {
          if (this.confirmRequest === request) this.confirmRequest = null;
          resolve(ok);
        },
      };
      this.confirmRequest = request;
    });
  }

  errorText(error: unknown): string {
    return t(`error.${errorCode(error)}`);
  }

  fail(error: unknown): void {
    sfx.play('error');
    this.toast(this.errorText(error), 'error');
  }

  /** An action that cannot run now: a soft sound and a short note that says why. Not an error. */
  refuse(text: string): void {
    sfx.play('cancel');
    this.toast(text, 'info');
  }

  /** Counts the work as busy; the progress pill shows when it lasts longer than the progress delay. */
  async track<T>(work: Promise<T>): Promise<T> {
    this.busyCount++;
    const timer = setTimeout(() => {
      if (this.busyCount > 0) this.showProgress = true;
    }, TUNING.ui.progressDelayMs);
    try {
      return await work;
    } finally {
      clearTimeout(timer);
      this.busyCount--;
      if (this.busyCount === 0) {
        this.showProgress = false;
        this.progress = null;
      }
    }
  }

  // ----- tools, colors and settings -----

  /** Deactivates the old tool (it commits or cancels its pending state), then activates the new one. */
  setTool(id: ToolId): void {
    if (id === this.tool) return;
    TOOLS[this.tool]?.deactivate?.();
    this.tool = id;
    TOOLS[id]?.activate?.();
    sfx.play('tool');
  }

  setFg(color: Rgba, remember = true): void {
    this.fg = opaque(color);
    if (remember) this.remember(this.fg);
  }

  setBg(color: Rgba): void {
    this.bg = opaque(color);
  }

  swapColors(): void {
    [this.fg, this.bg] = [this.bg, this.fg];
    sfx.play('tick');
  }

  resetColors(): void {
    this.fg = BLACK;
    this.bg = WHITE;
    sfx.play('tick');
  }

  /** Puts the color first in the recent list, without a copy of it further down. */
  remember(color: Rgba): void {
    const next = [opaque(color), ...this.recentColors.filter((entry) => !sameColor(entry, color))].slice(0, TUNING.ui.recentColors);
    this.recentColors = next;
    writeStored('colors', JSON.stringify(next));
  }

  setBrush(tool: BrushToolId, patch: Partial<BrushSettings>): BrushSettings {
    const next = cleanBrush({ ...this.brush[tool], ...patch }, this.brush[tool]);
    this.brush = { ...this.brush, [tool]: next };
    writeStored('brush', JSON.stringify(this.brush));
    return next;
  }

  setBucket(patch: Partial<BucketSettings>): void {
    this.bucket = cleanBucket({ ...this.bucket, ...patch }, this.bucket);
    writeStored('bucket', JSON.stringify(this.bucket));
  }

  setView(patch: Partial<ViewFlags>): void {
    this.view = { ...this.view, ...patch };
    writeStored('view', JSON.stringify(this.view));
  }

  openPanel(id: PanelId): void {
    this.panel = id;
  }

  openDialog(id: DialogId): void {
    this.dialog = id;
  }

  setExportPrefs(patch: { format?: ExportFormat; jpegQuality?: number }): void {
    if (patch.format !== undefined && isFormat(patch.format)) this.lastFormat = patch.format;
    if (patch.jpegQuality !== undefined) this.jpegQuality = cleanQuality(patch.jpegQuality, this.jpegQuality);
    writeStored('export', JSON.stringify({ format: this.lastFormat, jpegQuality: this.jpegQuality }));
  }

  setWeight(weight: WeightState): void {
    this.weight = { bytes: weight.bytes, pending: weight.pending, upper: weight.upper === true };
  }

  /** The next primary press on the stage goes to the handler, not to the tool. */
  requestStagePick(handler: ((p: StagePointer) => void) | null): void {
    this.stagePick = handler;
  }

  /** A new request object each time, so the crop tool sees a repeat of the same ratio. */
  requestCrop(ratioW: number, ratioH: number): void {
    if (!this.doc) return;
    this.cropRequest = { ratioW, ratioH, mode: 'crop' };
    this.setTool('crop');
  }

  // ----- documents -----

  /** True when there is nothing to lose, or when the user agrees to lose it. */
  private async confirmDiscard(): Promise<boolean> {
    if (!this.doc?.history.dirty) return true;
    return this.confirm(t('chrome.discard.title'), t('chrome.discard.body'), t('chrome.discard.confirm'));
  }

  private setDocument(doc: EditorDoc | null): void {
    TOOLS[this.tool]?.deactivate?.();
    this.panel = 'none';
    this.dialog = 'none';
    this.stagePick = null;
    this.cropRequest = null;
    this.weight = { bytes: null, pending: false };
    this.doc = doc;
    if (doc) TOOLS[this.tool]?.activate?.();
  }

  private async decodeFile(file: File): Promise<RasterImage | null> {
    try {
      const bytes = await file.arrayBuffer();
      const { image } = await this.track(this.engine.decode(bytes, file.name));
      return image;
    } catch (error) {
      this.fail(error);
      return null;
    }
  }

  private warnIfLarge(width: number, height: number): void {
    const pixels = width * height;
    if (pixels > PARAMS.limits.warnPixels) this.toast(t('chrome.bigImage', { mp: Math.round(pixels / 1e6) }), 'info');
  }

  /** 'auto': a document when none is open, else a layer. With several files, the others become layers. */
  async openFiles(files: readonly File[], as: 'auto' | 'document' | 'layer'): Promise<void> {
    const images = files.filter(isImageFile);
    if (images.length === 0) {
      sfx.play('error');
      this.toast(t('toast.notImage'), 'error');
      return;
    }
    if (images.length < files.length) this.toast(t('toast.skippedFiles', { count: files.length - images.length }), 'info');
    const mode = as === 'auto' ? (this.doc ? 'layer' : 'document') : this.doc ? as : 'document';
    let rest = images;
    if (mode === 'document') {
      if (!(await this.confirmDiscard())) return;
      const [first] = images;
      rest = images.slice(1);
      const image = await this.decodeFile(first);
      if (!image) return;
      const name = docName(first);
      this.setDocument(
        new EditorDoc({ width: image.width, height: image.height, name, layers: [createRasterLayer(name, image)], sourceBytes: first.size }),
      );
      sfx.play('open');
      this.warnIfLarge(image.width, image.height);
    }
    for (const file of rest) await this.addImageLayer(file);
  }

  /** Adds the image above the active layer, centered; an image larger than the stage is fitted inside it. */
  private async addImageLayer(file: File): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    let image = await this.decodeFile(file);
    if (!image || this.doc !== doc) return;
    const name = docName(file);
    let fitted = false;
    if (image.width > doc.width || image.height > doc.height) {
      const scale = Math.min(doc.width / image.width, doc.height / image.height);
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      try {
        image = await this.track(this.engine.resize(image, width, height, 'auto'));
      } catch (error) {
        this.fail(error);
        return;
      }
      if (this.doc !== doc) return;
      fitted = true;
    }
    const x = Math.round((doc.width - image.width) / 2);
    const y = Math.round((doc.height - image.height) / 2);
    doc.addLayer(createRasterLayer(name, image, x, y));
    sfx.play('layer');
    this.toast(fitted ? t('chrome.layerFitted', { name }) : t('chrome.layerAdded', { name }), fitted ? 'info' : 'success');
  }

  async newDocument(width: number, height: number, fill: Rgba | null): Promise<void> {
    const { maxSide } = PARAMS.limits;
    const w = Math.round(clamp(width, 1, maxSide));
    const h = Math.round(clamp(height, 1, maxSide));
    if (w * h > PARAMS.limits.maxPixels) {
      this.fail(new CoreError('too-large', `The stage would have ${w * h} pixels.`));
      return;
    }
    if (!(await this.confirmDiscard())) return;
    const image = createRaster(w, h, fill && fill.a > 0 ? fill : undefined);
    const layer = createRasterLayer(t('doc.backgroundName'), image);
    this.setDocument(new EditorDoc({ width: w, height: h, name: t('chrome.untitled'), layers: [layer] }));
    sfx.play('open');
    this.warnIfLarge(w, h);
  }

  /** Asks when the document is dirty. False when the user keeps it. */
  async closeDocument(): Promise<boolean> {
    if (!this.doc) return true;
    if (!(await this.confirmDiscard())) return false;
    this.setDocument(null);
    return true;
  }

  undo(): void {
    this.stepHistory('undo');
  }

  redo(): void {
    this.stepHistory('redo');
  }

  private stepHistory(direction: 'undo' | 'redo'): void {
    const doc = this.doc;
    if (!doc) return;
    const entry = direction === 'undo' ? doc.undo() : doc.redo();
    this.dismissToast(this.historyToast);
    if (!entry) {
      sfx.play('cancel');
      this.historyToast = this.toast(t(direction === 'undo' ? 'chrome.nothingUndo' : 'chrome.nothingRedo'), 'info', undefined, TUNING.ui.undoToastMs);
      return;
    }
    sfx.play(direction);
    const text = t(direction === 'undo' ? 'chrome.undone' : 'chrome.redone', { label: t(entry.label) });
    this.historyToast = this.toast(text, 'info', undefined, TUNING.ui.undoToastMs);
  }
}

export const app = new AppState();
