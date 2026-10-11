import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Test whether Assistant blocks contain a user-facing reply rather than only
 * reasoning or Tool-call protocol material. A text block equal to the bare
 * object marker `{}` is NOT visible content: it is the empty-object shield
 * marker the model emits when a conversation turn shape suppresses free
 * text — the same value AssistantNodeView suppresses at the node seam.
 * @param blocks - Assistant content blocks.
 * @returns whether the blocks contain visible reply content.
 */
export function hasAssistantReplyContent(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'reasoning' || block.kind === 'tool-call') return false
    if (block.kind === 'text') return block.text.trim() !== '' && block.text.trim() !== '{}'
    return true
  })
}
