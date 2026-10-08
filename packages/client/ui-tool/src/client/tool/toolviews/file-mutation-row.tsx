import type { Context } from '@deepseek-ai/cordis'
import { IconEditOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { diffCardModel } from '../models/diff-card-model.ts'
import { writeFramesRowModel } from '../models/frames-row-model.ts'
import { toolRowModel } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'
import { CONVERSATION_NS as NS } from '../../locale.ts'

type FileMutationRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/**
 * Lets users expand an applied file diff and open the reported path.
 */
export function FileMutationRow({ toolName, block, cwd, home, openFile, inspect, t }: FileMutationRowProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  const diff = diffCardModel(block)
  // A batched `write` stacks one diff card per element (plus detach lines)
  // instead of the merged single card; the suffix carries the batch totals.
  const frames = writeFramesRowModel(block, cwd, home)
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      icon={<IconEditOutline16 size={14} />}
      title={t(model.titleKey)}
      summary={frames === null
        ? model.summary
        : t('write.batchSummary', { count: frames.count, first: frames.firstLabel })}
      output={model.output}
      errorSummary={model.errorSummary}
      diff={frames === null ? diff : undefined}
      frames={frames ?? undefined}
      state={model.state}
      filePath={frames === null ? model.filePath : frames.firstPath}
      summarySuffix={frames !== null && frames.stat !== null ? `+${frames.stat.added} -${frames.stat.removed}` : undefined}
      onOpenFile={openFile}
      inspect={inspect}
    />
  )
}

/** Registers the edit and write conversation rows. */
export const fileMutationToolview = {
  name: 'file-mutation-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'edit', locale: NS }, FileMutationRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'write', locale: NS }, FileMutationRow)
    })
  },
}
