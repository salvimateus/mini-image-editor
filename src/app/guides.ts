import type { Guide } from './doc.svelte.ts';

/** Guides at the stage center, or at the thirds of each axis. */
export function guidePreset(kind: 'center' | 'thirds', w: number, h: number, nextId: () => number): Guide[] {
  if (kind === 'center') {
    return [
      { id: nextId(), axis: 'x', pos: w / 2 },
      { id: nextId(), axis: 'y', pos: h / 2 },
    ];
  }
  return [
    { id: nextId(), axis: 'x', pos: w / 3 },
    { id: nextId(), axis: 'x', pos: (w * 2) / 3 },
    { id: nextId(), axis: 'y', pos: h / 3 },
    { id: nextId(), axis: 'y', pos: (h * 2) / 3 },
  ];
}

/** The guides plus the new ones, without a second guide at the same axis and position. */
export function mergeGuides(current: readonly Guide[], added: readonly Guide[]): Guide[] {
  const out = [...current];
  for (const guide of added) {
    if (!out.some((entry) => entry.axis === guide.axis && Math.abs(entry.pos - guide.pos) < 1e-6)) out.push(guide);
  }
  return out;
}
