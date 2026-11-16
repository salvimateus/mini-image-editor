import { TIP_SHAPES, type TipShape } from '../core/brush-tip.ts';
import { SKETCH_PRESET_IDS, type SketchPresetId } from '../core/params/paint.ts';
import { CoreError, errorCode } from '../core/errors.ts';
import { FORMAT_INFO } from '../core/formats.ts';
import { PARAMS } from '../core/params/index.ts';
import { createRaster } from '../core/raster.ts';
import type { ExportFormat, RasterImage, Rgba, SvgSpec } from '../core/types.ts';
import type { StageApi, StagePointer } from '../ui/stage-renderer.ts';
import { track } from './analytics.ts';
import { EditorDoc } from './doc.svelte.ts';
import { ImageEngine } from './engine.ts';
import { cleanBaseName } from './file-name.ts';
import { t } from './i18n/index.ts';
import { lastGrid } from './last-used.ts';
import { createRasterLayer, createSvgLayer } from './layers.ts';
import { colorField, onPrefsReset, pickField, readJson, readPrefs, savePrefs } from './prefs.ts';
import * as sfx from './sfx.ts';
import { checkStaleBuild, isLoadFailure } from './stale-build.ts';
import { fitSvgSpec, growSvgSpec, isSvgFile, readSvgFile, renderSvgLayer } from './svg-render.ts';
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
  /** Stays until the user closes it; the toast limit drops the other toasts first. */
  sticky: boolean;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  resolve: (ok: boolean) => void;
}

/** size in px; hardness and opacity 0..1. */
export interface BrushSettings { size: number; hardness: number; opacity: number; shape: TipShape }
export type BrushToolId = 'brush' | 'pencil' | 'eraser' | 'clone' | 'sketch' | 'highlighter';
/** The pencil tool keeps one size for each preset; `size` is always the size of the active preset. */
export interface SketchSettings extends BrushSettings { preset: SketchPresetId; sizes: Record<SketchPresetId, number> }
export type BrushMap = Record<BrushToolId, BrushSettings> & { sketch: SketchSettings };
/** The brush tools that offer the square tip; the others stay round. */
export const SHAPED_BRUSHES: ReadonlySet<BrushToolId> = new Set<BrushToolId>(['brush', 'eraser', 'highlighter']);
export type PanelId = 'none' | 'hue-saturation' | 'levels' | 'sharpen' | 'vignette' | 'text' | 'frame';
export type DialogId = 'none' | 'new-image' | 'canvas-size' | 'image-size' | 'export' | 'shortcuts' | 'about';
export interface ViewFlags { rulers: boolean; guides: boolean; grid: boolean; snap: boolean; avatar: boolean; hud: boolean }
export interface BucketSettings { tolerance: number; contiguous: boolean }
export interface CropRequest { ratioW: number; ratioH: number; mode: 'crop' | 'expand' }
/** upper: `bytes` is the size before optimization, and the optimized size is still in work. */
export interface WeightState { bytes: number | null; pending: boolean; upper?: boolean }

export const BRUSH_TOOLS: readonly BrushToolId[] = ['brush', 'pencil', 'eraser', 'clone', 'sketch', 'highlighter'];
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };

const COLORS_KEY = 'colors';
const PREFS_VERSION = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function cleanBrush(value: Partial<BrushSettings>, base: BrushSettings): BrushSettings {
  const { min, max } = TUNING.ui.brushSize;
  return {
    size: Math.round(clamp(finite(value.size, base.size), min, max)),
    hardness: clamp(finite(value.hardness, base.hardness), 0, 1),
    opacity: clamp(finite(value.opacity, base.opacity), 0.01, 1),
    shape: pickField(value.shape, TIP_SHAPES, base.shape),
  };
}

/** The tip shape that a stroke of `tool` uses. */
export function brushShape(tool: BrushToolId): TipShape {
  return SHAPED_BRUSHES.has(tool) ? app.brush[tool].shape : 'round';
}

function cleanSketch(value: Partial<SketchSettings>, base: SketchSettings): SketchSettings {
  const { min, max } = TUNING.ui.brushSize;
  const preset = pickField(value.preset, SKETCH_PRESET_IDS, base.preset);
  const stored: Partial<Record<SketchPresetId, unknown>> = value.sizes && typeof value.sizes === 'object' ? value.sizes : {};
  const sizes = {} as Record<SketchPresetId, number>;
  for (const id of SKETCH_PRESET_IDS) sizes[id] = Math.round(clamp(finite(stored[id], base.sizes[id]), min, max));
  return { ...cleanBrush(value, base), size: sizes[preset], preset, sizes };
}

/** The stored brush settings, or the defaults when `stored` is null. A tool with no stored entry gets its defaults. */
function loadBrushes(stored = readPrefs('brush', PREFS_VERSION)): BrushMap {
  const entryOf = (id: BrushToolId) => {
    const entry = stored?.[id];
    return entry && typeof entry === 'object' ? entry : {};
  };
  const out = {} as Record<BrushToolId, BrushSettings>;
  for (const id of BRUSH_TOOLS) out[id] = cleanBrush(entryOf(id) as Partial<BrushSettings>, TUNING.ui.brushDefaults[id]);
  return { ...out, sketch: cleanSketch(entryOf('sketch') as Partial<SketchSettings>, TUNING.ui.brushDefaults.sketch) };
}

function cleanBucket(value: Partial<BucketSettings>, base: BucketSettings): BucketSettings {
  return {
    tolerance: Math.round(clamp(finite(value.tolerance, base.tolerance), 0, 255)),
    contiguous: typeof value.contiguous === 'boolean' ? value.contiguous : base.contiguous,
  };
}

function loadView(): ViewFlags {
  const stored = readPrefs('view', PREFS_VERSION) ?? {};
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

interface StoredColors { fg: Rgba; bg: Rgba; recent: Rgba[] }

function cleanRecent(value: unknown): Rgba[] {
  return Array.isArray(value) ? value.filter(isRgba).map(opaque).slice(0, TUNING.ui.recentColors) : [];
}

/** The foreground, background and recent colors. An old stored list holds only the recent colors. */
function loadColors(): StoredColors {
  const raw = readJson(COLORS_KEY);
  if (Array.isArray(raw)) return { fg: BLACK, bg: WHITE, recent: cleanRecent(raw) };
  const stored = readPrefs(COLORS_KEY, PREFS_VERSION);
  return { fg: colorField(stored?.fg, BLACK, true), bg: colorField(stored?.bg, WHITE, true), recent: cleanRecent(stored?.recent) };
}

/** The document name of a file: the file name without its extension. */
function docName(file: File): string {
  return cleanBaseName(file.name.replace(/\.[^.]+$/, '')) || t('chrome.untitled');
}

function trackOpen(file: File, mode: 'document' | 'layer', width: number, height: number): void {
  const svg = isSvgFile(file);
  const format = (/\.([^.]+)$/.exec(file.name)?.[1] ?? file.type.replace(/^image\//, '')).toLowerCase().slice(0, 10);
  track('image_open', { kind: svg ? 'svg' : 'raster', format, mode, width, height });
}

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/x-ms-bmp', 'image/svg+xml']);
const ACCEPTED_EXTENSIONS = /\.(png|jpe?g|jfif|webp|gif|bmp|svg)$/i;

/** The value of the `accept` attribute of every image file input. */
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg';

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

  /** The open documents, one tab each, in tab order. */
  docs = $state.raw<readonly EditorDoc[]>([]);
  /** The active document, one of `docs`; null shows the welcome screen. */
  doc = $state.raw<EditorDoc | null>(null);
  readonly engine = new ImageEngine();
  tool = $state<ToolId>('move');
  fg = $state.raw<Rgba>(BLACK);
  bg = $state.raw<Rgba>(WHITE);
  recentColors = $state.raw<readonly Rgba[]>([]);
  brush = $state.raw<BrushMap>(loadBrushes());
  bucket = $state.raw<BucketSettings>(cleanBucket(readPrefs('bucket', PREFS_VERSION) ?? {}, TUNING.ui.bucketDefaults));
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
  private newVersionToast = 0;

  constructor() {
    const colors = loadColors();
    this.fg = colors.fg;
    this.bg = colors.bg;
    this.recentColors = colors.recent;
    const stored = readPrefs('export', PREFS_VERSION);
    const defaults = TUNING.ui.exportDefaults;
    this.lastFormat = isFormat(stored?.format) ? stored.format : defaults.format;
    this.jpegQuality = cleanQuality(stored?.jpegQuality, defaults.jpegQuality);
    this.engine.onProgress((ratio) => {
      if (this.busyCount > 0) this.progress = ratio;
    });
    onPrefsReset(() => this.resetSettings());
  }

  /** The settings of the store go back to their defaults; `resetPrefs` empties the storage after it. */
  private resetSettings(): void {
    this.fg = BLACK;
    this.bg = WHITE;
    this.recentColors = [];
    this.brush = loadBrushes(null);
    this.bucket = { ...TUNING.ui.bucketDefaults };
    this.view = { ...TUNING.ui.viewDefaults };
    this.lastFormat = TUNING.ui.exportDefaults.format;
    this.jpegQuality = TUNING.ui.exportDefaults.jpegQuality;
    if (this.muted) this.toggleMute();
  }

  private saveColors(): void {
    savePrefs(COLORS_KEY, PREFS_VERSION, { fg: this.fg, bg: this.bg, recent: this.recentColors });
  }

  get busy(): boolean {
    return this.busyCount > 0;
  }

  toggleMute(): void {
    this.muted = !this.muted;
    sfx.setMuted(this.muted);
  }

  /** Returns the toast id, for `dismissToast`. An `ms` of Infinity makes a sticky toast. */
  toast(text: string, kind: ToastKind = 'info', action?: ToastAction, ms?: number): number {
    const id = ++this.toastId;
    const life = ms ?? (action ? TUNING.ui.toastActionMs : kind === 'error' ? TUNING.ui.toastErrorMs : TUNING.ui.toastMs);
    const sticky = life === Infinity;
    const list = [...this.toasts, { id, text, kind, action: action ?? null, sticky }];
    while (list.length > TUNING.ui.maxToasts) {
      const oldest = list.findIndex((toast) => !toast.sticky);
      list.splice(Math.max(oldest, 0), 1);
    }
    this.toasts = list;
    if (!sticky) setTimeout(() => this.dismissToast(id), life);
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

  /** A load failure in a tab of an old build shows the new-version note instead of the error. */
  fail(error: unknown): void {
    track('app_error', { error_code: errorCode(error) });
    if (!isLoadFailure(error)) {
      this.showError(error);
      return;
    }
    void checkStaleBuild().then((stale) => {
      if (stale) this.onNewVersion();
      else this.showError(error);
    });
  }

  /** A file of the app did not load: when the server has a newer build, reload or ask for a reload. */
  handleLoadFailure(): void {
    void checkStaleBuild().then((stale) => {
      if (stale) this.onNewVersion();
    });
  }

  private showError(error: unknown): void {
    sfx.play('error');
    this.toast(this.errorText(error), 'error');
  }

  /**
   * With no unsaved work, the page reloads at once. Else a note asks the user to save and reload; the reload goes
   * through the leave guard. The first note is sticky; after the user closes it, later failures show a timed one.
   */
  private onNewVersion(): void {
    if (!this.anyDirty) {
      location.reload();
      return;
    }
    if (this.toasts.some((toast) => toast.id === this.newVersionToast)) return;
    const first = this.newVersionToast === 0;
    const action = { label: t('toast.reload'), run: () => location.reload() };
    this.newVersionToast = this.toast(t('toast.newVersion'), 'info', action, first ? Infinity : undefined);
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
    else this.saveColors();
  }

  setBg(color: Rgba): void {
    this.bg = opaque(color);
    this.saveColors();
  }

  swapColors(): void {
    [this.fg, this.bg] = [this.bg, this.fg];
    this.saveColors();
    sfx.play('tick');
  }

  resetColors(): void {
    this.fg = BLACK;
    this.bg = WHITE;
    this.saveColors();
    sfx.play('tick');
  }

  /** Puts the color first in the recent list, without a copy of it further down. */
  remember(color: Rgba): void {
    const next = [opaque(color), ...this.recentColors.filter((entry) => !sameColor(entry, color))].slice(0, TUNING.ui.recentColors);
    this.recentColors = next;
    this.saveColors();
  }

  /** For the pencil tool, a size is the size of the preset, and a preset change brings back the size of that preset. */
  setBrush(tool: BrushToolId, patch: Partial<SketchSettings>): BrushSettings {
    let next: BrushSettings;
    if (tool === 'sketch') {
      const current = this.brush.sketch;
      const preset = pickField(patch.preset, SKETCH_PRESET_IDS, current.preset);
      const sizes = patch.size === undefined ? current.sizes : { ...current.sizes, [preset]: patch.size };
      const sketch = cleanSketch({ ...current, ...patch, preset, sizes }, current);
      this.brush = { ...this.brush, sketch };
      next = sketch;
    } else {
      next = cleanBrush({ ...this.brush[tool], ...patch }, this.brush[tool]);
      this.brush = { ...this.brush, [tool]: next };
    }
    savePrefs('brush', PREFS_VERSION, this.brush);
    return next;
  }

  setBucket(patch: Partial<BucketSettings>): void {
    this.bucket = cleanBucket({ ...this.bucket, ...patch }, this.bucket);
    savePrefs('bucket', PREFS_VERSION, this.bucket);
  }

  setView(patch: Partial<ViewFlags>): void {
    this.view = { ...this.view, ...patch };
    savePrefs('view', PREFS_VERSION, this.view);
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
    savePrefs('export', PREFS_VERSION, { format: this.lastFormat, jpegQuality: this.jpegQuality });
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

  isOpen(doc: EditorDoc): boolean {
    return this.docs.includes(doc);
  }

  /** Some open document has changes that are not exported. */
  get anyDirty(): boolean {
    return this.docs.some((doc) => doc.history.dirty);
  }

  /**
   * A name that the app made (a new image, a pasted image) gets the smallest free number among the open tabs, so the
   * tabs stay apart: "Untitled", "Untitled 2", "Untitled 3". A name from a user file stays as it is.
   */
  private tabName(name: string): string {
    const madeNames = [t('chrome.untitled'), t('doc.pastedImageName'), t('doc.pastedSvgName')];
    if (!madeNames.includes(name)) return name;
    const used = new Set(this.docs.map((doc) => doc.name));
    if (!used.has(name)) return name;
    for (let n = 2; ; n++) {
      const numbered = t('chrome.numberedName', { name, n });
      if (!used.has(numbered)) return numbered;
    }
  }

  /** True when there is nothing to lose in `doc`, or when the user agrees to lose it. */
  private async confirmDiscard(doc: EditorDoc): Promise<boolean> {
    if (!doc.history.dirty) return true;
    return this.confirm(t('chrome.discard.title'), t('chrome.discard.body'), t('chrome.discard.confirm'));
  }

  /** False, with a note, when one more document would pass the tab limit. */
  private canOpenDocument(): boolean {
    const max = PARAMS.limits.maxDocuments;
    if (this.docs.length < max) return true;
    this.refuse(t('toast.tabLimit', { max }));
    return false;
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

  /** Adds `doc` as a new tab and makes it active. */
  private openDocument(doc: EditorDoc): void {
    // A new document starts with the grid of the last one.
    doc.setGrid(lastGrid());
    this.docs = [...this.docs, doc];
    this.setDocument(doc);
  }

  /** Makes an open document the active one. */
  selectDocument(doc: EditorDoc): void {
    if (doc === this.doc || !this.isOpen(doc)) return;
    this.setDocument(doc);
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

  /** The SVG of the file at the size that `fit` gives, rendered on the main thread: the decode worker has no DOM. */
  private async renderSvgFile(file: File, fit: (spec: SvgSpec) => SvgSpec): Promise<{ spec: SvgSpec; image: RasterImage; external: boolean } | null> {
    try {
      const parsed = await readSvgFile(file);
      const spec = fit(parsed.spec);
      const image = await this.track(renderSvgLayer(spec));
      return { spec, image, external: parsed.external };
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
    // One note for each action, however many SVG files refer to outside fonts or images.
    let external = false;
    let target = this.doc;
    if (mode === 'document') {
      if (!this.canOpenDocument()) return;
      const [first] = images;
      rest = images.slice(1);
      const name = this.tabName(docName(first));
      let doc: EditorDoc;
      if (isSvgFile(first)) {
        const svg = await this.renderSvgFile(first, (spec) => growSvgSpec(spec, PARAMS.svg.minDocumentSide));
        if (!svg) return;
        const { spec, image } = svg;
        external = svg.external;
        // No source size: the export compare would set a text file against a raster encode.
        doc = new EditorDoc({ width: image.width, height: image.height, name, layers: [createSvgLayer(name, spec, image, 0, 0)], sourceBytes: null });
      } else {
        const image = await this.decodeFile(first);
        if (!image) return;
        doc = new EditorDoc({ width: image.width, height: image.height, name, layers: [createRasterLayer(name, image)], sourceBytes: first.size });
      }
      // Another open can take the last tab during the decode.
      if (!this.canOpenDocument()) return;
      this.openDocument(doc);
      target = doc;
      sfx.play('open');
      this.warnIfLarge(doc.width, doc.height);
      trackOpen(first, 'document', doc.width, doc.height);
    }
    if (target) for (const file of rest) if (await this.addImageLayer(target, file)) external = true;
    if (external) this.toast(t('chrome.svgExternal'), 'info');
  }

  /**
   * Adds the image above the active layer, centered; an image larger than the stage is fitted inside it. True when it
   * is an SVG that refers to fonts or images outside the file.
   */
  private async addImageLayer(doc: EditorDoc, file: File): Promise<boolean> {
    if (!this.isOpen(doc)) return false;
    if (isSvgFile(file)) return this.addSvgLayer(doc, file);
    let image = await this.decodeFile(file);
    if (!image || !this.isOpen(doc)) return false;
    const name = docName(file);
    const source = { width: image.width, height: image.height };
    let fitted = false;
    if (image.width > doc.width || image.height > doc.height) {
      const scale = Math.min(doc.width / image.width, doc.height / image.height);
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      try {
        image = await this.track(this.engine.resize(image, width, height, 'auto'));
      } catch (error) {
        this.fail(error);
        return false;
      }
      if (!this.isOpen(doc)) return false;
      fitted = true;
    }
    const x = Math.round((doc.width - image.width) / 2);
    const y = Math.round((doc.height - image.height) / 2);
    doc.addLayer(createRasterLayer(name, image, x, y));
    sfx.play('layer');
    trackOpen(file, 'layer', source.width, source.height);
    this.toast(fitted ? t('chrome.layerFitted', { name }) : t('chrome.layerAdded', { name }), fitted ? 'info' : 'success');
    return false;
  }

  /** Adds the SVG above the active layer, centered, at the largest size that fits inside the stage (up or down). */
  private async addSvgLayer(doc: EditorDoc, file: File): Promise<boolean> {
    const svg = await this.renderSvgFile(file, (spec) => fitSvgSpec(spec, doc.width, doc.height));
    if (!svg || !this.isOpen(doc)) return false;
    const { spec, image } = svg;
    const name = docName(file);
    const x = Math.round((doc.width - image.width) / 2);
    const y = Math.round((doc.height - image.height) / 2);
    doc.addLayer(createSvgLayer(name, spec, image, x, y));
    sfx.play('layer');
    trackOpen(file, 'layer', image.width, image.height);
    this.toast(t('chrome.layerAdded', { name }), 'success');
    return svg.external;
  }

  async newDocument(width: number, height: number, fill: Rgba | null): Promise<void> {
    const { maxSide } = PARAMS.limits;
    const w = Math.round(clamp(width, 1, maxSide));
    const h = Math.round(clamp(height, 1, maxSide));
    if (w * h > PARAMS.limits.maxPixels) {
      this.fail(new CoreError('too-large', `The stage would have ${w * h} pixels.`));
      return;
    }
    if (!this.canOpenDocument()) return;
    const image = createRaster(w, h, fill && fill.a > 0 ? fill : undefined);
    const layer = createRasterLayer(t('doc.backgroundName'), image);
    this.openDocument(new EditorDoc({ width: w, height: h, name: this.tabName(t('chrome.untitled')), layers: [layer] }));
    sfx.play('open');
    this.warnIfLarge(w, h);
  }

  /**
   * Closes the tab of `doc` (the active document by default) and asks first when it is dirty. A dirty background tab
   * becomes active before the question, so the user sees what can be lost. False when the user keeps it.
   */
  async closeDocument(doc: EditorDoc | null = this.doc): Promise<boolean> {
    if (!doc || !this.isOpen(doc)) return true;
    if (doc.history.dirty) this.selectDocument(doc);
    if (!(await this.confirmDiscard(doc))) return false;
    // A second close of the same tab during the question already removed it.
    const index = this.docs.indexOf(doc);
    if (index < 0) return true;
    const rest = this.docs.filter((open) => open !== doc);
    this.docs = rest;
    if (doc === this.doc) this.setDocument(rest[index] ?? rest[index - 1] ?? null);
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
