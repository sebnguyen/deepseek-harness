// A compaction marker does not replace shadowed transcript rows. The marker is
// one pce row: the cited summary is its body, expandable only when the current
// window includes that summary.

import { memo, useMemo } from 'react'
import { MarkdownText, PceRow } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PceKind, PceState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { markdownLabels } from '../markdown-labels.ts'
import type { CompactionSummaryNode } from '../contract/snapshot.ts'
import css from './MessageItem.module.css'

interface CompactionItemProps {
  node: CompactionSummaryNode
  /** Automatic checkpoint, or the manual `/compact` transaction. */
  kind: Extract<PceKind, 'compaction' | 'manual-compaction'>
  /** Marker label, localized by the owner. */
  title: string
  /** Command settlement text used when structured compaction counts are unavailable. */
  fallbackSummary?: string | null
  /** Manual command outcome; automatic markers are always `ok`. */
  state?: PceState
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}

/**
 * Render the model-history compaction marker as one pce row.
 * @param props - the marker node off the snapshot cache.
 * @returns the marker row, with the summary disclosure when one is available.
 */
export const CompactionItem = memo(function CompactionItem({
  node,
  kind,
  title,
  fallbackSummary,
  state = 'ok',
  t,
}: CompactionItemProps) {
  const labels = useMemo(() => markdownLabels(t), [t])
  const summary = node.shadowedItemCount !== null && node.shadowedTokenCount !== null
    ? t('message.compaction.completed', {
      items: node.shadowedItemCount,
      tokens: node.shadowedTokenCount,
    })
    : fallbackSummary
      ?? (node.summary === null ? t('message.compaction.unavailable') : t('message.compaction.expand'))
  return (
    <PceRow
      kind={kind}
      glyph={kind === 'compaction' ? 'folder-close' : 'copy'}
      title={title}
      summary={summary}
      state={state}
      body={node.summary === null
        ? null
        : <div className={css.compactionBody}><MarkdownText text={node.summary} labels={labels} /></div>}
    />
  )
})
