// Only a structured checkpoint uses the compaction marker; all other outcomes
// retain the command's complete settlement text.

import type { PceState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps, CommandRowOwnerProps } from '../contract/slots.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { GenericCommandCard } from './GenericCommandCard.tsx'

interface CompactionCommandCardProps extends CommandRowOwnerProps {
  t: ChatViewSlotProps['t']
}

/** The row outcome a manual compaction mirrors from its owning command. */
function stateOf(outcome: CommandRowOwnerProps['node']['outcome']): PceState {
  if (outcome === null) return 'running'
  return outcome.kind === 'error' ? 'error' : 'ok'
}

/** Render one manual compaction lifecycle without duplicating its checkpoint marker. */
export function CompactionCommandCard({ node, compaction, t }: CompactionCommandCardProps) {
  if (compaction !== undefined) {
    return (
      <CompactionItem
        node={compaction}
        kind="manual-compaction"
        title={t('message.compaction.commandTitle')}
        fallbackSummary={node.outcome?.text ?? null}
        state={stateOf(node.outcome)}
        t={t}
      />
    )
  }
  if (node.outcome !== null) return <GenericCommandCard node={node} t={t} />
  return <GenericCommandCard node={node} t={t} runningSummary={t('message.compaction.running')} />
}
