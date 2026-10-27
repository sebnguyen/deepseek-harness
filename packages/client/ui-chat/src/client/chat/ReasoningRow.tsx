/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { extractMarkdownPlainText, PceRow } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './ReasoningRow.module.css'

/** How many characters the head's description line carries. */
const EXCERPT_LIMIT = 120
/** How much of the stream is parsed for that line; bounds the per-publish cost. */
const EXCERPT_INPUT_LIMIT = 400

/**
 * One line of the reasoning stream for the head's description: the Markdown
 * flattened to plain text, its whitespace collapsed, and the line capped with
 * an ellipsis. The parsed input is bounded, so a growing stream costs the
 * same per publish as a short one.
 * @param text - the reasoning text so far.
 * @returns the excerpt, or an empty string when there is nothing to show.
 */
function reasoningExcerpt(text: string): string {
  if (text === '') return ''
  const plain = extractMarkdownPlainText(text.slice(0, EXCERPT_INPUT_LIMIT), { mode: 'all' })
  const normalized = plain.replace(/\s+/g, ' ').trim()
  return normalized.length > EXCERPT_LIMIT
    ? `${normalized.slice(0, EXCERPT_LIMIT - 1).trimEnd()}…`
    : normalized
}

/**
 * Render one assistant reasoning block as the proposed `Think` row. The
 * collapsed head shows a truncated excerpt of the reasoning; the expanded body
 * preserves the complete text.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.t - conversation locale seat for the status labels.
 * @returns the reasoning pce row.
 */
export function ReasoningRow({ text, running, t }: { text: string; running: boolean; t: ChatViewSlotProps['t'] }) {
  const stateLabel = running ? t('message.think.streaming') : t('message.think.finished')
  return (
    <div className={css.root} data-variant="think" data-state={running ? 'running' : 'ok'}>
      <PceRow
        kind="reasoning"
        glyph="think"
        title={t('message.think')}
        summary={reasoningExcerpt(text)}
        state={running ? 'running' : 'ok'}
        stateLabel={stateLabel}
        body={<div className={css.thinkBody}>{text}</div>}
      />
    </div>
  )
}
