/**
 * Per-event content preview for the Context Window tab's click-to-expand
 * cards. Each surface event, plus each `request/header` event (the source of
 * the synthetic `'tools'` composition node — see
 * `@deepseek-ai/dsh-token-meter`'s `composition-projection.ts`), becomes its
 * own one-shot Context keyed by `seq` (never `update`d) — this sidesteps turn
 * attribution entirely: `user/message` carries no `turn` field on its own
 * data (unlike `system/message`, `assistant/message`, and `tool/result`,
 * which do), so grouping by turn the way `context-window-turn-definition.ts`
 * does cannot reach it. Content lookup only needs a seq → text map, not a
 * turn grouping.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNodeDefinition, ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** One surface event's extracted text, keyed by its durable seq. */
export interface ContextWindowContentPreview {
  readonly seq: number
  readonly text: string
}

/** Render one content block as plain text; unknown block types fall through to a bracketed tag. */
function blockText(block: ContentBlock): string {
  switch (block.type) {
    case 'text': return block.text
    case 'reasoning': return block.text
    case 'tool-call': return `${block.name}(${block.arguments})`
    case 'tool-result': return block.content.map(blockText).join('\n')
    case 'image': return '[image]'
    case 'file': return '[file]'
    default: return `[${(block as { type: string }).type}]`
  }
}

/** Render the current request envelope's full tool schemas, one per definition, name/description plus its exact JSON Schema. */
function describeToolSchemas(event: SessionEvent<'request/header'>): string {
  const tools = event.data.header.tools ?? []
  if (tools.length === 0) return ''
  return tools.map(tool =>
    `${tool.name}: ${tool.description}\n${JSON.stringify(tool.parameters, null, 2)}`).join('\n\n')
}

/**
 * Extract a plain-text preview from one surface event's exact message
 * content, or (for `request/header`) the current request envelope's full
 * tool schemas.
 * @param event - a `system/message`, `user/message`, `assistant/message`, `tool/result`, or `request/header` event.
 * @returns the joined block text, or `''` for an event type this Definition does not describe.
 */
export function describeEventContent(event: SessionEvent): string {
  switch (event.type) {
    case 'system/message': return event.data.message.content.map(blockText).join('\n\n')
    case 'user/message': return event.data.content.map(blockText).join('\n\n')
    case 'assistant/message': return event.data.message.content.map(blockText).join('\n\n')
    case 'tool/result': return event.data.message.content.map(blockText).join('\n\n')
    case 'request/header': return describeToolSchemas(event)
    default: return ''
  }
}

interface ContentPreviewState {
  readonly preview: ContextWindowContentPreview
}

const contextWindowContentDefinition: ConversationNodeDefinition<ContentPreviewState> = {
  kind: 'context-window-content',
  target: 'context-window',
  match: (event) => {
    if (
      event.type === 'system/message'
      || event.type === 'user/message'
      || event.type === 'assistant/message'
      || event.type === 'tool/result'
      || event.type === 'request/header'
    ) return { id: String(event.seq), role: 'start' }
    return null
  },
  start: (_context, match) => ({
    preview: { seq: match.event.seq, text: describeEventContent(match.event) },
  }),
  // One-shot: the same seq's content never changes once logged.
  update: context => context.state,
  buildViewNode: (context): ConversationViewNode | null => context.state === undefined ? null : {
    key: context.key,
    kind: 'context-window-content',
    id: context.id,
    target: 'context-window',
    data: context.state.preview,
  },
}

/**
 * Register the per-event content-preview Definition feeding the Context
 * Window tab's click-to-expand cards.
 * @param ctx - owning client Context.
 */
export function registerContextWindowContentDefinition(ctx: Context): void {
  ctx.uiConversation.events.register(contextWindowContentDefinition)
}
