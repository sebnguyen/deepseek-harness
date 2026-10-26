import { memo } from 'react'
import type { ChatNodeViewProps, ChatViewSlotProps } from '../contract/slots.ts'
import { PceRow } from '@deepseek-ai/dsh-client-ui-primitives'
import { OpaqueBody } from './ContextBody.tsx'
import css from './ContextInjectionRow.module.css'

/** Props for one complete system prompt disclosure. */
export interface SystemPromptRowProps {
  /** Complete model-visible prompt text. */
  text: string
  /** True when the prompt replaced an earlier one from this position in the history. */
  update?: boolean
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}

/**
 * Render one complete system prompt as a pce row whose expanded body is the
 * model-facing text in a code block. An in-history update uses the same row
 * under its own title.
 * @param props - Complete prompt text, whether it is an update, and the locale seat.
 * @returns The system-prompt pce row.
 */
export function SystemPromptRow({ text, update = false, t }: SystemPromptRowProps) {
  return (
    <div className={css.root}>
      <PceRow
        kind="system-prompt"
        glyph="setting"
        title={t(update ? 'message.systemPromptUpdate' : 'message.systemPrompt')}
        state="ok"
        keepMounted
        body={(
          <div className="pce-code" data-system-prompt-body>
            <div className="pce-code-body">
              <OpaqueBody content={[{ type: 'text', text }]} source={null} t={t} />
            </div>
          </div>
        )}
      />
    </div>
  )
}

/** System-prompt keyed Chat renderer. */
export const SystemPromptNodeView = memo(function SystemPromptNodeView({
  node, t,
}: Pick<ChatNodeViewProps<'system-prompt'>, 'node' | 't'>) {
  return <SystemPromptRow text={node.data.text} update={node.data.update === true} t={t} />
})
