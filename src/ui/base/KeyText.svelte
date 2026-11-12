<script lang="ts" module>
  /** A text piece, or the parts of one `[[Alt+Click]]` token: [['Alt'], ['Click']]. */
  type Piece = { text: string } | { combo: string[][] };

  const TOKEN = /\[\[([^\]]+)\]\]/g;

  /** 'Clique [[Alt+Click]] ou [[Esc]]' → text, combo, text, combo. '[ ]' inside a token gives two keys in one part. */
  export function splitKeyText(text: string): Piece[] {
    const pieces: Piece[] = [];
    let last = 0;
    for (const match of text.matchAll(TOKEN)) {
      const at = match.index ?? 0;
      if (at > last) pieces.push({ text: text.slice(last, at) });
      pieces.push({ combo: match[1].split('+').map((part) => part.trim().split(/\s+/).filter(Boolean)) });
      last = at + match[0].length;
    }
    if (last < text.length) pieces.push({ text: text.slice(last) });
    return pieces;
  }
</script>

<script lang="ts">
  import Keys from './Keys.svelte';

  interface Props {
    /** A translated text whose `[[Key]]` or `[[Ctrl+Z]]` tokens show as keycaps. */
    text: string;
    /** The slow tap animation that teaches the keys. */
    hint?: boolean;
  }

  let { text, hint = false }: Props = $props();

  const pieces = $derived(splitKeyText(text));
</script>

{#each pieces as piece, index (index)}
  {#if 'text' in piece}{piece.text}{:else}<span class="key-combo"
      >{#each piece.combo as part, partIndex (partIndex)}{#if partIndex > 0}<span class="plus" aria-hidden="true">+</span>{/if}<Keys
          keys={part}
          {hint}
        />{/each}</span
    >{/if}
{/each}

<style>
  @layer components {
    .key-combo {
      display: inline-flex;
      align-items: center;
      gap: 0.25em;
      margin-inline: 0.1em;
      vertical-align: middle;
    }

    .plus {
      color: var(--text-faint);
      font-weight: 800;
    }
  }
</style>
