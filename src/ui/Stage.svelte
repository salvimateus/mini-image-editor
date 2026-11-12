<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import type { Point } from '../core/types.ts';
  import { TUNING } from '../app/tuning/index.ts';
  import { Camera } from './camera.ts';
  import { watchCanvasBox, type CanvasBox } from './canvas-box.ts';
  import { ParticleField } from './particles.ts';
  import { onThemeChange } from '../app/theme.svelte.ts';
  import { loadStageColors, type Scene, type StageApi, type StageHost, type StagePointer } from './stage-renderer.ts';

  interface Props {
    scene: Scene;
    label: string;
    cursor?: string;
    /** Return false to ignore the press, or 'pan' to move the view with it. */
    onprimarydown?: (p: StagePointer) => boolean | 'pan' | void;
    onprimarymove?: (p: StagePointer) => void;
    onprimaryup?: (p: StagePointer) => void;
    /** A right click that did not turn into a pan. */
    onaltclick?: (p: StagePointer) => void;
    onhover?: (p: StagePointer | null) => void;
    /** After each zoom, pan or resize. */
    onviewchange?: () => void;
    /** The stage API after mount, and null before destroy. */
    onready?: (api: StageApi | null) => void;
    children?: Snippet;
  }

  let { scene, label, cursor = 'default', onprimarydown, onprimarymove, onprimaryup, onaltclick, onhover, onviewchange, onready, children }: Props = $props();

  type DragMode = 'pan' | 'tool' | 'alt';
  interface Drag {
    mode: DragMode;
    pointerId: number;
    button: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  }

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let fxCanvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let fx: CanvasRenderingContext2D | null = null;
  let sized = false;
  let raf = 0;
  let lastFrame = 0;
  let mainDirty = true;
  let fxDirty = true;
  let drag: Drag | null = null;
  let spaceHeld = $state(false);
  let panning = $state(false);
  let dpr = 1;
  let dprY = 1;
  /** Until the user zooms or pans, a resize frames the content again. */
  let userMoved = false;
  let reducedMotion = false;

  const camera = new Camera();
  const particles = new ParticleField();

  const host: StageHost = {
    camera,
    particles,
    get dpr() {
      return dpr;
    },
    get reducedMotion() {
      return reducedMotion;
    },
    invalidate,
    invalidateFx,
  };

  const api: StageApi = {
    camera,
    host,
    particles,
    get viewport() {
      return { width: camera.viewW, height: camera.viewH };
    },
    fitView,
    zoomBy,
    zoomTo,
    invalidate,
    invalidateFx,
    docToScreen: (x: number, y: number): Point => camera.imageToScreen(x, y),
    screenToDoc: (sx: number, sy: number): Point => camera.screenToImage(sx, sy),
  };

  export function invalidate(): void {
    mainDirty = true;
    fxDirty = true;
    request();
  }

  export function invalidateFx(): void {
    fxDirty = true;
    request();
  }

  function request(): void {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  /** Reads the content size of the scene again and frames it. */
  export function fitView(): void {
    userMoved = false;
    camera.setContent(scene.contentW, scene.contentH, scene.maxZoom);
    camera.fit(scene.initialZoom(camera));
    invalidate();
    onviewchange?.();
  }

  export function zoomBy(factor: number, sx = camera.viewW / 2, sy = camera.viewH / 2): void {
    userMoved = true;
    camera.zoomAt(sx, sy, factor, !reducedMotion);
    invalidate();
    onviewchange?.();
  }

  export function zoomTo(scale: number, sx = camera.viewW / 2, sy = camera.viewH / 2): void {
    userMoved = true;
    camera.zoomTo(scale, sx, sy, !reducedMotion);
    invalidate();
    onviewchange?.();
  }

  function frame(now: number): void {
    raf = 0;
    if (!sized) {
      lastFrame = 0;
      return;
    }
    const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
    const moving = camera.step(dt);
    // One more fx frame after the last spark dies, so that it leaves the canvas.
    const hadSparks = particles.alive;
    const sparks = particles.step(dt);
    if (moving) mainDirty = fxDirty = true;
    if (hadSparks || sparks) fxDirty = true;
    const alive = render(now);
    if (moving) onviewchange?.();
    if (moving || sparks || alive || mainDirty || fxDirty) {
      lastFrame = now;
      request();
    } else {
      lastFrame = 0;
    }
  }

  /** Draws the dirty canvases. Returns true while the scene asks for more frames. */
  function render(now: number): boolean {
    if (!ctx || !fx || !sized) return false;
    let alive = false;
    if (mainDirty) {
      mainDirty = false;
      ctx.setTransform(dpr, 0, 0, dprY, 0, 0);
      ctx.clearRect(0, 0, camera.viewW, camera.viewH);
      ctx.imageSmoothingEnabled = camera.zoom < TUNING.stage.zoom.pixelatedFrom;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalAlpha = 1;
      if (scene.draw(ctx, now)) {
        mainDirty = true;
        alive = true;
      }
    }
    if (fxDirty) {
      fxDirty = false;
      fx.setTransform(dpr, 0, 0, dprY, 0, 0);
      fx.clearRect(0, 0, camera.viewW, camera.viewH);
      fx.imageSmoothingEnabled = true;
      fx.globalAlpha = 1;
      if (scene.drawFx(fx, now)) {
        fxDirty = true;
        alive = true;
      }
      particles.draw(fx);
    }
    return alive;
  }

  /** The backing stores equal the canvas box in physical pixels, so the browser never resamples the frame. */
  function resize(box: CanvasBox): void {
    const { cssW: width, cssH: height } = box;
    dpr = box.pxW / width;
    dprY = box.pxH / height;
    for (const target of [canvas, fxCanvas]) {
      target.width = box.pxW;
      target.height = box.pxH;
    }
    // The fx canvas sits on the same whole physical pixels as the main canvas.
    fxCanvas.style.translate = canvas.style.translate;
    fxCanvas.style.width = canvas.style.width;
    fxCanvas.style.height = canvas.style.height;
    camera.setViewport(width, height);
    if (!sized) {
      sized = true;
      camera.setContent(scene.contentW, scene.contentH, scene.maxZoom);
    }
    if (!userMoved) camera.fit(scene.initialZoom(camera));
    // A canvas resize clears it: draw now so the frame never flashes empty.
    mainDirty = fxDirty = true;
    render(performance.now());
    request();
    onviewchange?.();
  }

  // Only a new scene runs this again: what attach and fit read stays untracked.
  $effect(() => {
    const current = scene;
    untrack(() => {
      current.attach(host);
      userMoved = false;
      if (sized) {
        camera.setContent(current.contentW, current.contentH, current.maxZoom);
        camera.fit(current.initialZoom(camera));
        onviewchange?.();
      }
      invalidate();
    });
    return () => untrack(() => current.attach(null));
  });

  onMount(() => {
    loadStageColors();
    ctx = canvas.getContext('2d');
    fx = fxCanvas.getContext('2d');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const applyMotion = () => {
      reducedMotion = motion.matches;
      particles.enabled = !reducedMotion;
      if (reducedMotion) particles.clear();
      invalidate();
    };
    applyMotion();
    motion.addEventListener('change', applyMotion);

    const stopBox = watchCanvasBox(canvas, resize, TUNING.stage.maxDpr);
    // Wheel needs passive: false, or preventDefault cannot stop the page from zooming or scrolling.
    wrap.addEventListener('wheel', onWheel, { passive: false });
    // The particle sprite and every canvas color belong to the old theme.
    const stopTheme = onThemeChange(() => {
      particles.clear();
      invalidate();
      invalidateFx();
    });
    onready?.(api);
    return () => {
      onready?.(null);
      stopTheme();
      stopBox();
      motion.removeEventListener('change', applyMotion);
      wrap.removeEventListener('wheel', onWheel);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
  });

  function pointer(event: PointerEvent | WheelEvent, samples?: readonly Point[]): StagePointer {
    const rect = canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const p = camera.screenToImage(sx, sy);
    return {
      sx,
      sy,
      ix: p.x,
      iy: p.y,
      shift: event.shiftKey,
      alt: event.altKey,
      ctrl: event.ctrlKey || event.metaKey,
      button: drag?.button ?? event.button,
      samples: samples ?? [p],
    };
  }

  /** The document points of the coalesced events of a move, the last one equal to the event itself. */
  function coalesced(event: PointerEvent): Point[] {
    const rect = canvas.getBoundingClientRect();
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    const list = events.length ? events : [event];
    const points = list.map((entry) => camera.screenToImage(entry.clientX - rect.left, entry.clientY - rect.top));
    points[points.length - 1] = camera.screenToImage(event.clientX - rect.left, event.clientY - rect.top);
    return points;
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? camera.viewH : 1;
    const max = TUNING.stage.zoom.wheelMaxDelta;
    const delta = Math.max(-max, Math.min(max, event.deltaY * unit));
    if (delta === 0) return;
    const p = pointer(event);
    zoomBy(Math.exp(-delta * TUNING.stage.zoom.wheelSensitivity), p.sx, p.sy);
  }

  function onPointerDown(event: PointerEvent): void {
    if (drag) return;
    // The stage takes the focus, so Space never clicks a button that kept it.
    wrap.focus({ preventScroll: true });
    const p = pointer(event);
    let mode: DragMode | null = null;
    if (event.button === 1 || (event.button === 0 && spaceHeld)) mode = 'pan';
    else if (event.button === 2) mode = 'alt';
    else if (event.button === 0) {
      const answer = onprimarydown?.(p);
      mode = answer === false || answer === undefined ? null : answer === 'pan' ? 'pan' : 'tool';
    }
    if (!mode) return;
    event.preventDefault();
    drag = { mode, pointerId: event.pointerId, button: event.button, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY };
    panning = mode === 'pan';
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) {
      onhover?.(pointer(event));
      return;
    }
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (drag.mode === 'alt' && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > TUNING.stage.altPanThresholdPx) {
      drag.mode = 'pan';
      panning = true;
      camera.panBy(event.clientX - drag.startX - dx, event.clientY - drag.startY - dy);
    }
    if (drag.mode === 'pan') {
      userMoved = true;
      camera.panBy(dx, dy);
      invalidate();
      onviewchange?.();
    } else if (drag.mode === 'tool') {
      onprimarymove?.(pointer(event, coalesced(event)));
    }
  }

  function endDrag(event: PointerEvent, cancelled: boolean): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const p = pointer(event);
    const mode = drag.mode;
    drag = null;
    panning = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (mode === 'tool') onprimaryup?.(p);
    else if (mode === 'alt' && !cancelled) onaltclick?.(p);
  }

  function isEditable(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  function onWindowKeyDown(event: KeyboardEvent): void {
    if (event.code !== 'Space' || isEditable(event.target)) return;
    // Space on a focused button clicks it: let that button keep its own Space.
    if (!(event.target instanceof HTMLButtonElement)) event.preventDefault();
    spaceHeld = true;
  }

  function onWindowKeyUp(event: KeyboardEvent): void {
    if (event.code === 'Space') spaceHeld = false;
  }

  const activeCursor = $derived(panning ? 'grabbing' : spaceHeld ? 'grab' : cursor);
</script>

<svelte:window onkeydown={onWindowKeyDown} onkeyup={onWindowKeyUp} onblur={() => (spaceHeld = false)} />

<!-- The stage is a focusable application region, so a press moves the focus away from the buttons. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="stage" bind:this={wrap} role="application" aria-label={label} tabindex="0" style:cursor={activeCursor}>
  <canvas
    class="stage-canvas"
    bind:this={canvas}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={(event) => endDrag(event, false)}
    onpointercancel={(event) => endDrag(event, true)}
    onpointerleave={() => {
      if (!drag) onhover?.(null);
    }}
    oncontextmenu={(event) => event.preventDefault()}
  ></canvas>
  <canvas class="stage-fx" bind:this={fxCanvas} aria-hidden="true"></canvas>
  {#if children}
    <div class="stage-overlay">{@render children()}</div>
  {/if}
</div>

<style>
  @layer components {
    .stage {
      position: relative;
      min-width: 0;
      min-height: 0;
      overflow: clip;
      contain: strict;
      background: var(--stage-bg);
      touch-action: none;
      user-select: none;

      &:focus-visible {
        outline: 2px solid var(--focus);
        outline-offset: -4px;
      }
    }

    .stage-canvas,
    .stage-fx {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }

    .stage-fx {
      pointer-events: none;
    }

    .stage-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;

      & > :global(*) {
        pointer-events: auto;
      }
    }
  }
</style>
