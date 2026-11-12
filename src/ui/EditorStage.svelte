<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '../app/i18n/index.ts';
  import { app } from '../app/state.svelte.ts';
  import { TOOLS, type ToolController } from '../app/tools/index.ts';
  import { TUNING } from '../app/tuning/index.ts';
  import { EditorScene } from './editor-scene.ts';
  import { FLOATS } from './floats/index.ts';
  import { OVERLAYS, type SceneOverlay } from './overlays/index.ts';
  import Rulers from './Rulers.svelte';
  import Stage from './Stage.svelte';
  import type { StageApi, StagePointer } from './stage-renderer.ts';

  /** The top overlay gets the press first. */
  const POINTER_CHAIN: readonly SceneOverlay[] = [...OVERLAYS].reverse();

  // One scene for each document; what the constructor reads must not make a new scene.
  const scene = $derived.by(() => {
    const doc = app.doc;
    return doc ? untrack(() => new EditorScene(doc)) : null;
  });

  let api: StageApi | null = null;
  /** The owner of the drag in progress: an overlay or the tool that took the press. */
  let dragOverlay: SceneOverlay | null = null;
  let dragTool: ToolController | null = null;
  let hoverPoint: StagePointer | null = null;
  let altHeld = false;
  let cursor = $state('default');
  let lastSize: { doc: object; w: number; h: number } | null = null;

  function refreshCursor(): void {
    const p = hoverPoint && hoverPoint.alt !== altHeld ? { ...hoverPoint, alt: altHeld } : hoverPoint;
    cursor = TOOLS[app.tool].cursor(p);
  }

  function onReady(next: StageApi | null): void {
    const old = api;
    api = next;
    if (next) app.stage = next;
    else if (app.stage === old) app.stage = null;
    if (next) onViewChange();
  }

  function onViewChange(): void {
    const camera = api?.camera;
    if (!camera) return;
    untrack(() => {
      app.zoom = camera.zoom;
      app.viewTick += 1;
    });
  }

  function onDown(p: StagePointer): boolean | 'pan' {
    for (const overlay of POINTER_CHAIN) {
      if (!overlay.pointerDown?.(p)) continue;
      dragOverlay = overlay;
      api?.invalidateFx();
      return true;
    }
    const pick = app.stagePick;
    if (pick) {
      app.requestStagePick(null);
      pick(p);
      api?.invalidateFx();
      return false;
    }
    const tool = TOOLS[app.tool];
    const answer = tool.down?.(p) ?? false;
    if (answer === true) dragTool = tool;
    return answer;
  }

  function onMove(p: StagePointer): void {
    if (dragOverlay) dragOverlay.pointerMove?.(p);
    else dragTool?.move?.(p);
  }

  function onUp(p: StagePointer): void {
    const overlay = dragOverlay;
    const tool = dragTool;
    dragOverlay = null;
    dragTool = null;
    if (overlay) overlay.pointerUp?.(p);
    else tool?.up?.(p);
    api?.invalidateFx();
  }

  function onAltClick(p: StagePointer): void {
    TOOLS[app.tool].altClick?.(p);
  }

  function onHover(p: StagePointer | null): void {
    hoverPoint = p;
    if (p) altHeld = p.alt;
    TOOLS[app.tool].hover?.(p);
    refreshCursor();
  }

  function onAltKey(event: KeyboardEvent): void {
    if (event.key !== 'Alt') return;
    altHeld = event.type === 'keydown';
    refreshCursor();
  }

  function onBlur(): void {
    altHeld = false;
    refreshCursor();
  }

  function hasFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes('Files') ?? false;
  }

  function canDrop(): boolean {
    return app.confirmRequest === null && app.dialog === 'none';
  }

  function onDragOver(event: DragEvent): void {
    if (!hasFiles(event) || !canDrop()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  /** A file dropped on the stage becomes a layer. preventDefault tells the window handler that the drop is used. */
  function onDrop(event: DragEvent): void {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length || !canDrop()) return;
    event.preventDefault();
    app.openFiles(files, 'layer').catch((error: unknown) => app.fail(error));
  }

  // A new size of the stage (crop, canvas size, image size) frames it again. A new document is framed by Stage.
  $effect(() => {
    const doc = app.doc;
    if (!doc) return;
    const w = doc.width;
    const h = doc.height;
    untrack(() => {
      if (lastSize && lastSize.doc === doc && (lastSize.w !== w || lastSize.h !== h)) api?.fitView();
      lastSize = { doc, w, h };
    });
  });

  // The overlays and the cursor follow the tool and the view switches.
  $effect(() => {
    void app.tool;
    void app.view;
    untrack(() => {
      refreshCursor();
      api?.invalidateFx();
    });
  });
</script>

<svelte:window onkeydown={onAltKey} onkeyup={onAltKey} onblur={onBlur} />

{#if scene}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="editor-stage" class:has-rulers={app.view.rulers} style:--ruler-size="{TUNING.stage.rulerPx}px" ondragover={onDragOver} ondrop={onDrop}>
    {#if app.view.rulers}
      <div class="ruler-corner" aria-hidden="true"></div>
      <div class="ruler-top"><Rulers axis="x" /></div>
      <div class="ruler-left"><Rulers axis="y" /></div>
    {/if}
    <div class="stage-cell">
      <Stage
        {scene}
        label={t('stage.label')}
        {cursor}
        onprimarydown={onDown}
        onprimarymove={onMove}
        onprimaryup={onUp}
        onaltclick={onAltClick}
        onhover={onHover}
        onviewchange={onViewChange}
        onready={onReady}
      >
        {#each FLOATS as Float, index (index)}
          <Float />
        {/each}
      </Stage>
    </div>
  </div>
{/if}

<style>
  @layer components {
    .editor-stage {
      display: grid;
      grid-template: 'stage' minmax(0, 1fr) / minmax(0, 1fr);
      inline-size: 100%;
      block-size: 100%;
      min-inline-size: 0;
      min-block-size: 0;
      background: var(--stage-bg);
    }

    .has-rulers {
      grid-template:
        'corner top' var(--ruler-size)
        'left stage' minmax(0, 1fr)
        / var(--ruler-size) minmax(0, 1fr);
    }

    .ruler-corner {
      grid-area: corner;
      background: var(--stage-ruler);
      border-inline-end: 1px solid var(--stage-ruler-line);
      border-block-end: 1px solid var(--stage-ruler-line);
    }

    .ruler-top {
      grid-area: top;
      display: grid;
      min-inline-size: 0;
    }

    .ruler-left {
      grid-area: left;
      display: grid;
      min-block-size: 0;
    }

    .stage-cell {
      grid-area: stage;
      display: grid;
      min-inline-size: 0;
      min-block-size: 0;
    }
  }
</style>
