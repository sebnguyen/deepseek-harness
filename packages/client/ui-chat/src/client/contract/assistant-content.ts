import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Markdown code fence around a whole message body, e.g. ```json\n…\n```. */
const FENCE_PATTERN = /^```[\w-]*\s*\n([\s\S]*?)\n?```\s*$/

/** The empty-object shield schema's leaked body, with any inner whitespace. */
const SHIELD_MARKER_PATTERN = /^\{\s*\}$/

/**
 * Strip wire-grammar artifacts out of the assistant text channel before any
 * visibility decision runs (design/conversation-modes-redesign.md §3.3): a
 * trailing unparseable `<tool_call>…` span the model leaked as text, the
 * `{}`/`{ }` empty-object shield marker — bare or inside a ```json fence —
 * and empty text. Narrative text is returned trimmed; artifact-only text
 * collapses to ''.
 * @param text - one raw assistant text block.
 * @returns the narrative text, or '' when the block is pure artifact.
 */
export function sanitizeAssistantReplyText(text: string): string {
  let body = text
  const toolCallAt = body.indexOf('<tool_call')
  if (toolCallAt !== -1) body = body.slice(0, toolCallAt)
  body = body.trim()
  const fence = FENCE_PATTERN.exec(body)
  const fenced = fence?.[1]
  if (fenced !== undefined) body = fenced.trim()
  if (SHIELD_MARKER_PATTERN.test(body)) return ''
  return body
}

/**
 * The text blocks a viewer should render: text blocks reduced to pure
 * wire-grammar artifact by sanitizeAssistantReplyText are dropped; every
 * other block passes through untouched.
 * @param blocks - Assistant content blocks.
 * @returns the blocks with artifact-only text blocks removed.
 */
/**
 * Strip wire-grammar artifacts out of one assistant reasoning block before any
 * visibility decision runs. A reasoning body that is entirely a JSON value
 * (the provider-fidelity degradation class) or the `{}`/`{ }` shield marker,
 * bare or inside a ```json fence, collapses to '' so the whole Think row is
 * suppressed. Narrative reasoning is returned trimmed.
 * @param text - one raw assistant reasoning block.
 * @returns the narrative reasoning, or '' when the block is pure artifact.
 */
export function sanitizeAssistantReasoningText(text: string): string {
  let body = text.trim()
  if (body === '') return ''
  if (SHIELD_MARKER_PATTERN.test(body)) return ''
  const fence = FENCE_PATTERN.exec(body)
  const fenced = fence?.[1]
  if (fenced !== undefined) body = fenced.trim()
  if (SHIELD_MARKER_PATTERN.test(body)) return ''
  try {
    const parsed = JSON.parse(body)
    if (parsed !== null && typeof parsed === 'object') return ''
  } catch {
    // Not a JSON document — keep as narrative reasoning.
  }
  return body
}

export function visibleAssistantBlocks(blocks: readonly AssistantBlock[]): readonly AssistantBlock[] {
  return blocks.filter((block) => {
    if (block.kind === 'text') return sanitizeAssistantReplyText(block.text) !== ''
    if (block.kind === 'reasoning') return sanitizeAssistantReasoningText(block.text) !== ''
    return true
  })
}

/**
 * Test whether Assistant blocks contain a user-facing reply rather than only
 * reasoning or Tool-call protocol material. A text block that sanitizes to
 * nothing — the bare `{}` shield marker or a leaked `<tool_call>` span — is
 * NOT visible content: it is wire-grammar leakage the conversation turn
 * shape produced when suppressing free text, the same artifact
 * AssistantNodeView suppresses at the node seam.
 * @param blocks - Assistant content blocks.
 * @returns whether the blocks contain visible reply content.
 */
export function hasAssistantReplyContent(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'reasoning' || block.kind === 'tool-call') return false
    if (block.kind === 'text') return sanitizeAssistantReplyText(block.text) !== ''
    if (block.kind === 'other') {
      // An unknown content block carrying no payload — or the shield marker
      // as a raw object — prints as `null`/`{}` under the JsonBlock fallback.
      return block.block !== null && block.block !== undefined
        && JSON.stringify(block.block) !== '{}'
    }
    return true
  })
}
