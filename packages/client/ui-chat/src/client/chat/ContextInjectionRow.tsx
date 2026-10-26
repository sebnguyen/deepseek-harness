import type { ChatViewSlotProps } from '../contract/slots.ts'
import { PceRow, ReferenceIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextMessageNode } from '../contract/snapshot.ts'
import { contextBody } from './ContextBody.tsx'
import css from './ContextInjectionRow.module.css'

/** Props for the logged non-user message presentation. */
export interface ContextInjectionRowProps {
  content: ContextMessageNode['content']
  source: ContextMessageNode['source']
  /** Role and producer name projected from the durable source. */
  provenance: ContextMessageNode['provenance']
  /** Producer-declared information form; null renders the opaque body. */
  form: ContextMessageNode['form']
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/**
 * Render logged context with the Tool calls disclosure chrome from Figma.
 *
 * The header names the role the context plays and, beside it, the producer the
 * durable source identifies, so a reader can tell an injected skill catalog
 * from a workspace instruction file or a recalled session without expanding.
 * The expanded body follows the producer-declared form; an absent or unknown
 * form renders the opaque body.
 * @param props - Durable content, its projected producer role/name and form, and the locale seat.
 * @returns A collapsed context row with a bounded, form-specific body.
 */
export function ContextInjectionRow({ content, source, provenance, form, t }: ContextInjectionRowProps) {
  // Resolved rather than declared: a form whose fields are unreadable renders
  // the opaque body, and the marker must say what the row actually shows.
  const { rendered, summary, body } = contextBody(form, { content, source, t })

  return (
    <div className={css.root}>
      <PceRow
        kind="context"
        glyph="context"
        title={t(provenance.role === 'recall' ? 'message.contextRecall' : 'message.contextInjection')}
        summary={provenance.label}
        detail={summary}
        summaryData="data-context-source"
        detailData="data-context-summary"
        state="ok"
        keepMounted
        body={(
          <div className={css.body} data-context-injection-body data-context-form={rendered ?? undefined}>
            {provenance.role === 'recall' && (
              <span data-context-recall-icon><ReferenceIcon kind="session" /></span>
            )}
            {body}
          </div>
        )}
      />
    </div>
  )
}
