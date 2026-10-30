import { memo, useMemo } from 'react'
import { PceRow } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ChatNodeViewProps, CommandRowOwnerProps,
} from '../contract/slots.ts'
import { CompactionCommandCard } from './CompactionCommandCard.tsx'
import { GenericCommandCard } from './GenericCommandCard.tsx'

type CommandNodeViewProps = ChatNodeViewProps<'command'> & PropsRenderSlots<'conversation.chat.commandview'>

/** Ordinary command lifecycle renderer with command-name keyed specialization. */
export const CommandNodeView = memo(function CommandNodeView({ node, renderSlot, t, rowMarks }: CommandNodeViewProps) {
  const command = node.data
  const owner = useMemo<CommandRowOwnerProps>(() => ({ node: command }), [command])
  return (
    <PceRow
      kind="command"
      glyph="adjust"
      title={t('message.command')}
      state="ok"
      marks={rowMarks !== false}
      collapsible={false}
      body={(
        <div>
          {renderSlot('conversation.chat.commandview', owner, {
            entryKey: command.name ?? '',
            fallback: <GenericCommandCard {...owner} t={t} />,
          })}
        </div>
      )}
    />
  )
})

/** One integrated `/compact` command and compaction transaction renderer. */
export const ManualCompactionNodeView = memo(function ManualCompactionNodeView({
  node, t, rowMarks,
}: ChatNodeViewProps<'manual-compaction'>) {
  const data = node.data
  return (
    <CompactionCommandCard
      node={data.command}
      {...data.compaction === null ? {} : { compaction: data.compaction }}
      t={t}
      rowMarks={rowMarks}
    />
  )
})
