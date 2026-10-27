/** Shared pce row chrome for the non-terminal tool views. */
import { useMemo, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  CodeBlock, DiffBlock, PceRow, PceToolMaster, ReadBlock, StateDot, TerminalBlock,
  type PceKind, type PceToolRow, type PixelSymbolName,
  diffTotals,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { OpenFileOptions } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { CHAT_DIFF_MAX_LINES, type DiffCardModel } from '../models/diff-card-model.ts'
import { CHAT_READ_MAX_LINES, type ReadCardModel } from '../models/read-card-model.ts'
import type { FramesRowDiffAccessory, FramesRowItem, FramesRowModel } from '../models/frames-row-model.ts'
import type { ImageCardModel } from '../models/image-card-model.ts'
import type { SearchCardModel } from '../models/search-card-model.ts'
import {
  localizeTerminalCardModel, terminalBlockLabels, type TerminalCardModel,
} from '../models/terminal-card-model.ts'
import { diffBlockLabels, readBlockLabels } from '../models/primitive-labels.ts'
import type { AskQuestionCardModel } from '../models/ask-question-card-model.ts'
import { formatToolBody, type ToolRowState, type ToolRowVariant } from '../models/tool-call-model.ts'
import type { WebCardModelProps } from '../models/web-card-model.ts'
import { pceStateLabel } from './pce-label.ts'
import { PceAskBody, PceDiffBody, PceSearchBody, PceTodosBody, PceWebBody, type PceTodoItem } from './pce-bodies.tsx'
import css from './ToolRow.module.css'

export interface ToolRowProps {
  t: TranslateNS<'conversation'>
  variant: ToolRowVariant
  /** Wire tool name for tool-owned styling layered over the generic variant. */
  toolName?: string | undefined
  /** Kept for call-site compatibility; the pce head draws the catalog glyph. */
  icon?: ReactNode
  /** pce element kind; defaults from the variant. */
  pceKind?: PceKind | undefined
  /** Catalog glyph; defaults from the kind. */
  glyph?: PixelSymbolName | undefined
  title: string
  summary: string
  summarySuffix?: string | null | undefined
  bodyRaw?: string | null | undefined
  output?: string | null | undefined
  askQuestion?: AskQuestionCardModel | null | undefined
  errorSummary?: string | null | undefined
  terminal?: TerminalCardModel | null | undefined
  diff?: DiffCardModel | null | undefined
  read?: ReadCardModel | null | undefined
  image?: ImageCardModel | null | undefined
  renderSlot?: PropsRenderSlots<'tool.call.images'>['renderSlot'] | undefined
  loadImage?: MessageImageLoader | undefined
  search?: SearchCardModel | null | undefined
  web?: WebCardModelProps | null | undefined
  /** Parsed plan items for the todo body. */
  todos?: readonly PceTodoItem[] | null | undefined
  state: ToolRowState
  filePath?: string | undefined
  filePathLine?: number | undefined
  onOpenFile?: ((path: string, options?: OpenFileOptions) => void) | undefined
  frames?: FramesRowModel | undefined
}

const KIND_BY_VARIANT: Record<ToolRowVariant, PceKind> = {
  bash: 'bash',
  read: 'read',
  write: 'file-mutation',
  edit: 'file-mutation',
  search: 'search',
  code: 'tool-generic',
  others: 'tool-generic',
}

const GLYPH_BY_KIND: Partial<Record<PceKind, PixelSymbolName>> = {
  bash: 'bash',
  read: 'read',
  'file-mutation': 'write',
  search: 'internet',
  web: 'internet',
  'tool-generic': 'generic',
  todo: 'todo',
  ask: 'ask',
  'read-image': 'image-read',
}

/** One settled outcome note beside a stacked diff card. */
function accessoryText(accessory: FramesRowDiffAccessory | undefined, t: TranslateNS<'conversation'>): string | undefined {
  if (accessory === undefined) return undefined
  switch (accessory.kind) {
    case 'created': return t('write.createdFile')
    case 'dry-run': return t('write.dryRun')
    case 'edits': return t('write.editsApplied', { edits: accessory.edits, matches: accessory.matches })
  }
}

/** Stacked per-frame body of a batched read/write row. */
function FramesStack(props: {
  frames: FramesRowModel
  readLabels: ReturnType<typeof readBlockLabels>
  diffLabels: ReturnType<typeof diffBlockLabels>
  onOpenFile?: ((path: string, options?: OpenFileOptions) => void) | undefined
  t: TranslateNS<'conversation'>
}) {
  const { frames, readLabels, diffLabels, onOpenFile, t } = props
  const node = (item: FramesRowItem, key: number): ReactNode => {
    if (item.kind === 'read') {
      const { read } = item
      return (
        <ReadBlock
          key={key}
          {...read.card}
          labels={readLabels}
          maxLines={CHAT_READ_MAX_LINES}
          className={css.readBody}
          onLabelClick={onOpenFile === undefined
            ? undefined
            : () => onOpenFile(read.filePath, read.line === undefined ? undefined : { line: read.line })}
        />
      )
    }
    if (item.kind === 'diff') {
      const { diff } = item
      return (
        <DiffBlock
          key={key}
          diffs={diff.diffs}
          labels={diffLabels}
          maxLines={CHAT_DIFF_MAX_LINES}
          className={css.diffBody}
          accessory={accessoryText(diff.accessory, t)}
          onPathClick={onOpenFile === undefined ? undefined : () => onOpenFile(diff.filePath)}
        />
      )
    }
    const { failure } = item
    return (
      <div key={key} className="pce-detached" data-detached={failure.kind}>
        <StateDot state={failure.kind === 'error' ? 'error' : 'warning'} className={css.detachedDot} />
        <div className={css.detachedBody}>
          {onOpenFile === undefined
            ? <span className={css.detachedCommand}>{failure.filePath}</span>
            : (
              <button
                type="button"
                className={clsx('pce-detached-path')}
                onClick={(event) => {
                  event.stopPropagation()
                  if (failure.line === undefined) onOpenFile(failure.filePath)
                  else onOpenFile(failure.filePath, { line: failure.line })
                }}
              >
                {failure.filePath}
              </button>
            )}
          <span className={clsx('pce-detached-line', failure.kind === 'error' && 'is-error')}>
            {failure.kind === 'error'
              ? t('row.frameError', { message: failure.message })
              : t('row.frameNotRun', { reason: failure.message })}
          </span>
        </div>
      </div>
    )
  }
  // A batched read/write is innately a multi-element tool: give it bash's
  // master/detail table, with the selected element stacked underneath.
  const rows: PceToolRow[] = frames.items.map((item, index) => {
    const tone = item.kind === 'failure'
      ? (item.failure.kind === 'error' ? 'error' as const : 'stopped' as const)
      : 'ok' as const
    const primary = item.kind === 'read'
      ? item.read.card.label ?? item.read.filePath
      : item.kind === 'diff' ? item.diff.filePath : item.failure.filePath
    const detail = item.kind === 'read'
      ? (item.read.card.lines.length < item.read.card.totalLines
        ? t('read.window', { shown: item.read.card.lines.length, total: item.read.card.totalLines })
        : item.read.card.lang)
      : item.kind === 'diff'
        ? accessoryText(item.diff.accessory, t)
        : t(item.failure.kind === 'error' ? 'row.frameError' : 'row.frameNotRun',
          item.failure.kind === 'error' ? { message: item.failure.message } : { reason: item.failure.message })
    return { tone, state: pceStateLabel(tone, t), primary, detail, body: node(item, index) }
  })
  if (rows.length > 1) {
    return (
      <PceToolMaster
        rows={rows}
        column="FILE"
        previewKind="Diff"
        closeLabel={t('pce.closePreview')}
        previewLabel={t('pce.preview')}
      />
    )
  }
  return <>{frames.items.map((item, index) => node(item, index))}</>
}

/**
 * Render one tool call in the pce head/body shape.
 * @param props - model-derived row content and host callbacks.
 * @returns the pce article in a testable wrapper.
 */
export function ToolRow({
  t, variant, toolName, title, summary, summarySuffix, bodyRaw, output, askQuestion,
  errorSummary, terminal, diff, read, image, renderSlot, loadImage, search, web, todos,
  state, filePath, filePathLine, onOpenFile, frames,
  pceKind, glyph,
}: ToolRowProps) {
  const terminalLabels = useMemo(() => terminalBlockLabels(t), [t])
  const diffLabels = useMemo(() => diffBlockLabels(t), [t])
  const readLabels = useMemo(() => readBlockLabels(t), [t])
  const terminalBody = terminal === undefined || terminal === null ? null : localizeTerminalCardModel(terminal, t)
  const diffBody = diff ?? null
  const readBody = read ?? null
  const imageBody = image !== undefined && image !== null && renderSlot !== undefined && loadImage !== undefined ? image : null
  const searchBody = search ?? null
  const webBody = web ?? null
  const askQuestionBody = askQuestion ?? null
  const todoBody = todos !== undefined && todos !== null && todos.length > 0 ? todos : null
  const outputText = output ?? null
  const card = askQuestionBody ?? terminalBody ?? diffBody ?? readBody ?? imageBody ?? searchBody ?? webBody
  const framesBody = card === null && frames !== undefined && frames.items.length > 0 ? frames : null
  const failureLine = state === 'error' ? errorSummary ?? null : null
  const summaryText = failureLine ?? terminalBody?.description ?? summary
  const diffStat = useMemo(() => {
    if (diffBody === null) return null
    const { added, removed } = diffTotals(diffBody.card.diffs)
    return `+${added} -${removed}`
  }, [diffBody])
  const suffix = failureLine === null ? summarySuffix ?? diffStat : null
  const fileLink = filePath !== undefined && onOpenFile !== undefined && failureLine === null
  const resolvedKind = pceKind ?? KIND_BY_VARIANT[variant]
  const resolvedGlyph = glyph ?? GLYPH_BY_KIND[resolvedKind] ?? 'generic'
  const openPath = (path: string) => {
    if (onOpenFile === undefined) return
    if (filePathLine === undefined) onOpenFile(path)
    else onOpenFile(path, { line: filePathLine })
  }
  const hasBody = framesBody !== null || askQuestionBody !== null || terminalBody !== null
    || diffBody !== null || readBody !== null || imageBody !== null || searchBody !== null
    || webBody !== null || todoBody !== null || bodyRaw != null || outputText !== null
  const body: (() => ReactNode) | null = !hasBody
    ? null
    : () => {
      if (framesBody !== null) {
        return <FramesStack frames={framesBody} readLabels={readLabels} diffLabels={diffLabels} onOpenFile={onOpenFile} t={t} />
      }
      if (askQuestionBody !== null) return <PceAskBody card={askQuestionBody} />
      if (terminalBody !== null) {
        return (
          <TerminalBlock
            {...terminalBody.card}
            maxLines={Infinity}
            labels={terminalLabels}
            className="pce-terminal"
          />
        )
      }
      if (diffBody !== null) {
        return (
          <PceDiffBody
            diffs={diffBody.card.diffs}
            onOpenPath={onOpenFile === undefined ? undefined : openPath}
            copyLabel={t('copy')}
          />
        )
      }
      if (readBody !== null) {
        return <ReadBlock {...readBody} labels={readLabels} maxLines={CHAT_READ_MAX_LINES} className="pce-code" />
      }
      if (imageBody !== null) {
        return (
          <div className={css.imageBody}>
            <div className={css.imageLabel}>{imageBody.label}</div>
            {renderSlot !== undefined && loadImage !== undefined && renderSlot('tool.call.images', {
              images: imageBody.images,
              loadImage,
              align: 'start',
            })}
            <div className={css.imageMeta}>{imageBody.text}</div>
          </div>
        )
      }
      if (searchBody !== null) {
        return (
          <>
            <PceSearchBody search={searchBody} copyLabel={t('copy')} />
            {searchBody.recovery !== undefined && (
              <div className="pce-notice">{searchBody.recovery}</div>
            )}
          </>
        )
      }
      if (webBody !== null) return <PceWebBody web={webBody} />
      if (todoBody !== null) return <PceTodosBody todos={todoBody} />
      const bodyText = bodyRaw != null ? formatToolBody(variant, bodyRaw) : null
      if (variant === 'code') {
        return bodyText === null ? null : (
          <CodeBlock code={bodyText} lang="typescript" copyLabel={t('copy')} copiedLabel={t('copied')} />
        )
      }
      return (
        <div className={clsx(css.ioCard, 'pce-result')}>
          {bodyText !== null && (
            <div className={css.ioSection}>
              <span className={css.ioLabel}>{t('row.input')}</span>
              <span className={css.ioText}>{bodyText}</span>
            </div>
          )}
          {outputText !== null && (
            <div className={css.ioSection}>
              <span className={css.ioLabel}>{t('row.output')}</span>
              <span className={css.ioText} data-error={state === 'error' ? '' : undefined}>{outputText}</span>
            </div>
          )}
        </div>
      )
    }
  return (
    <div className={css.root} data-variant={variant} data-tool={toolName} data-state={state}>
      <PceRow
        kind={resolvedKind}
        glyph={resolvedGlyph}
        title={title}
        summary={summaryText}
        suffix={suffix}
        state={state}
        stateLabel={pceStateLabel(state, t)}
        onOpenSummary={fileLink ? () => openPath(filePath) : undefined}
        body={body}
      />
    </div>
  )
}
