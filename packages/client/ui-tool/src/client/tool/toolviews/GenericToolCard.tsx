import type { PceKind, PixelSymbolName } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallOwnerProps, ToolTreeProps } from '../../contract/slots.ts'
import { readCardModel } from '../models/read-card-model.ts'
import { diffCardModel } from '../models/diff-card-model.ts'
import { searchCardModel } from '../models/search-card-model.ts'
import { terminalCardModel, terminalFailed } from '../models/terminal-card-model.ts'
import { webCardModel } from '../models/web-card-model.ts'
import { fileRowChip, toolRowModel, type ToolRowVariant } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'

const VARIANT_PCE: Record<ToolRowVariant, { kind: PceKind; glyph: PixelSymbolName }> = {
  search: { kind: 'search', glyph: 'internet' },
  read: { kind: 'read', glyph: 'read' },
  bash: { kind: 'bash', glyph: 'bash' },
  write: { kind: 'file-mutation', glyph: 'write' },
  edit: { kind: 'file-mutation', glyph: 'write' },
  code: { kind: 'tool-generic', glyph: 'generic' },
  others: { kind: 'tool-generic', glyph: 'generic' },
}

/** Card props: the owner payload plus the render site's locale seat (plain prop). */
export interface GenericToolCardProps extends ToolCallOwnerProps {
  t: ToolTreeProps['t']
}

export function GenericToolCard({ toolName, block, cwd, home, openFile, inspect, revealFile, t }: GenericToolCardProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  const terminal = terminalCardModel(block, cwd)
  const read = readCardModel(block, cwd, home)
  const diff = diffCardModel(block)
  const search = searchCardModel(block)
  const web = webCardModel(block)
  // A failing exit status is the terminal card's own error signal (the call
  // itself settles isError:false), surfaced as the row's red state dot.
  const state = model.state === 'ok' && terminal !== null && terminalFailed(terminal)
    ? 'error'
    : model.state
  const singleFile = model.filePath !== undefined
  const chip = fileRowChip(model.filePath, revealFile, inspect)
  return (
    <ToolRow
      t={t}
      variant={model.variant}
      toolName={toolName}
      pceKind={VARIANT_PCE[model.variant].kind}
      glyph={VARIANT_PCE[model.variant].glyph}
      title={t(model.titleKey)}
      summary={model.summary}
      // Single-file tools never expose an args body — the path link is the only
      // args interaction. A card is not an args body: a read/write/edit row is
      // single-file AND carries a card, so the card expands under the path link.
      bodyRaw={singleFile ? null : model.bodyRaw}
      output={model.output}
      errorSummary={model.errorSummary}
      terminal={terminal}
      diff={diff}
      read={read}
      search={search}
      web={web}
      state={state}
      filePath={model.filePath}
      onOpenFile={singleFile ? openFile : undefined}
      inspect={chip.inspect}
      inspectKind={chip.inspectKind}
    />
  )
}
