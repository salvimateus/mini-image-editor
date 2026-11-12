<script lang="ts" module>
  import type { Component } from 'svelte';
  import HandGrab from '@lucide/svelte/icons/hand-grab';
  import Mouse from '@lucide/svelte/icons/mouse';
  import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
  import MouseRight from '@lucide/svelte/icons/mouse-right';
  import type { TextKey } from '../../app/i18n/index.ts';

  /** Mouse tokens of the tool hints: they show as a mouse chip, not as a keycap. */
  const POINTERS: Record<string, { icon: Component<{ size?: number | string }>; text: TextKey }> = {
    Click: { icon: MousePointerClick, text: 'pointer.click' },
    Drag: { icon: HandGrab, text: 'pointer.drag' },
    Wheel: { icon: Mouse, text: 'pointer.wheel' },
    RightClick: { icon: MouseRight, text: 'pointer.rightClick' },
  };
</script>

<script lang="ts">
  import { keyHud } from '../../app/key-hud.svelte.ts';
  import { t } from '../../app/i18n/index.ts';
  import { keyLabels, keyName, type ActionId } from '../../app/shortcuts.ts';

  interface Props {
    /** The action whose first combo shows. */
    id?: ActionId;
    /** Key labels or hint tokens, when there is no action: 'Alt', 'Space', '[', 'Click', 'Drag', 'Wheel'. */
    keys?: readonly string[];
    /** The slow tap animation that teaches a shortcut. */
    hint?: boolean;
  }

  let { id, keys, hint = false }: Props = $props();

  function label(token: string): string {
    return token === 'Space' ? t('key.space') : keyName(token);
  }

  const labels = $derived(id ? keyLabels(id) : (keys ?? []).map((token) => (token in POINTERS ? token : label(token))));
  // A click on a control of this action teaches its keys here too.
  const hudHint = $derived(id !== undefined && keyHud.item?.mode === 'hint' && keyHud.item.id === id ? keyHud.item.serial : 0);
</script>

{#if labels.length > 0}
  {#key hudHint}
    <span class="keycap-group">
      {#each labels as text, index (index)}
        {#if text in POINTERS && !id}
          {@const pointer = POINTERS[text]}
          {@const Icon = pointer.icon}
          <span class="pointer-chip"><Icon size="1.15em" />{t(pointer.text)}</span>
        {:else}
          <kbd class="keycap" class:is-pressed={keyHud.pressed.has(text)} class:is-hint={hint || hudHint > 0}>{text}</kbd>
        {/if}
      {/each}
    </span>
  {/key}
{/if}
