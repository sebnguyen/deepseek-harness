/**
 * Keyed `read` conversation row: the proposed chat element head (pixel mark,
 * openable path, state, toggle) over pce code blocks showing the returned file
 * lines. Batched `files` calls stack one block per successful element and a
 * detach line per failure or skipped element.
 */
import type { ReactNode } from 'react'
import { Fragment } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import type { ReadCardModel } from '../models/read-card-model.ts'
import { readCallLine, readCardModel } from '../models/read-card-model.ts'
import { readFramesRowModel, type FramesRowFailure, type FramesRowItem } from '../models/frames-row-model.ts'
import { toolRowModel, type ToolRowState } from '../models/tool-call-model.ts'
import { PceRow, PceToolMaster, type PceToolRow } from '@deepseek-ai/dsh-client-ui-primitives'
import { pceStateLabel } from '../components/pce-label.ts'
import { CONVERSATION_NS as NS } from '../../locale.ts'

type ReadRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/** Window/language tail for a read card's banner. */
function cardMeta(card: ReadCardModel, t: TranslateNS<'conversation'>): string | undefined {
  const parts: string[] = []
  if (card.lines.length < card.totalLines) {
    parts.push(t('read.window', { shown: card.lines.length, total: card.totalLines }))
  }
  if (card.lang !== undefined && card.lang !== '') parts.push(card.lang)
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/** The window line alone, kept as its own node so the localized copy stays exact. */
function windowLabel(card: ReadCardModel, t: TranslateNS<'conversation'>): string | undefined {
  return card.lines.length < card.totalLines
    ? t('read.window', { shown: card.lines.length, total: card.totalLines })
    : undefined
}

/** One pce code block: an openable path banner over line-numbered file lines. */
function ReadCodeCard(props: {
  card: ReadCardModel
  line: number | undefined
  action?: ReactNode | undefined
  openFile: (path: string, options?: { line?: number }) => void
  t: TranslateNS<'conversation'>
}) {
  const { card, line, action, openFile, t } = props
  const windowText = windowLabel(card, t)
  const lang = card.lang !== undefined && card.lang !== '' ? card.lang : undefined
  return (
    <div className="pce-code" data-read="">
      <div className="pce-code-head">
        <button
          type="button"
          className="pce-code-label"
          onClick={() => {
            if (card.label === undefined) return
            if (line === undefined) openFile(card.label)
            else openFile(card.label, { line })
          }}
        >
          {card.label}
        </button>
        {windowText !== undefined && <span className="pce-code-meta">{windowText}</span>}
        {lang !== undefined && <span className="pce-code-lang">{lang}</span>}
        {action}
      </div>
      <div className="pce-code-body">
        {card.lines.map(line => (
          <div key={line.number} className="pce-line">
            <span className="pce-gutter" aria-hidden="true">{line.number}</span>
            <span className="pce-line-text">{line.text === '' ? ' ' : line.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One failed or skipped batch element: its path plus the settled note. */
function ReadDetached(props: {
  failure: FramesRowFailure
  openFile: (path: string, options?: { line?: number }) => void
  t: TranslateNS<'conversation'>
}) {
  const { failure, openFile, t } = props
  return (
    <div className="pce-detached" data-detached={failure.kind}>
      <button
        type="button"
        className="pce-detached-path"
        onClick={() => {
          if (failure.line === undefined) openFile(failure.filePath)
          else openFile(failure.filePath, { line: failure.line })
        }}
      >
        {failure.filePath}
      </button>
      <span className={failure.kind === 'error' ? 'pce-detached-line is-error' : 'pce-detached-line'}>
        {failure.kind === 'error'
          ? t('row.frameError', { message: failure.message })
          : t('row.frameNotRun', { reason: failure.message })}
      </span>
    </div>
  )
}

/**
 * Lets users expand a completed read result and open its reported path at the
 * line the call started from.
 */
export function ReadRow({ toolName, block, cwd, home, openFile, inspect, revealFile, t }: ReadRowProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  const frames = readFramesRowModel(block, cwd, home)
  const card = readCardModel(block, cwd, home)
  const firstRead = frames?.items.find(item => item.kind === 'read')
  const firstPath = frames === null ? model.filePath : frames.firstPath
  const firstLine = frames === null
    ? readCallLine(block)
    : firstRead?.read.line
  const state: ToolRowState = model.state
  const summary = frames === null
    ? model.summary
    : t('read.batchSummary', { count: frames.count, first: frames.firstLabel })
  const frameBody = (item: FramesRowItem): ReactNode => {
    if (item.kind === 'read') {
      return (
        <ReadCodeCard
          card={item.read.card}
          line={item.read.line}
          action={revealFile === undefined
            ? (inspect === undefined ? undefined : <button type="button" className="pce-action" onClick={inspect}>{t('row.inspect')}</button>)
            : <button type="button" className="pce-action" onClick={() => { revealFile(item.read.filePath) }}>{t('row.open')}</button>}
          openFile={openFile}
          t={t}
        />
      )
    }
    if (item.kind === 'failure') {
      return <ReadDetached failure={item.failure} openFile={openFile} t={t} />
    }
    return null
  }
  // A batched read is innately a multi-file tool, so it takes bash's
  // master/detail table and stacks the selected file's card under it.
  const masterRows: PceToolRow[] = frames === null || frames.items.length < 2
    ? []
    : frames.items.flatMap((item): PceToolRow[] => {
      if (item.kind === 'read') {
        return [{
          tone: 'ok' as const,
          state: pceStateLabel('ok', t),
          primary: item.read.card.label ?? item.read.filePath,
          detail: cardMeta(item.read.card, t),
          body: frameBody(item),
        }]
      }
      if (item.kind === 'failure') {
        const failed = item.failure.kind === 'error'
        return [{
          tone: failed ? 'error' as const : 'stopped' as const,
          state: pceStateLabel(failed ? 'error' : 'stopped', t),
          primary: item.failure.filePath,
          detail: t(failed ? 'row.frameError' : 'row.frameNotRun',
            failed ? { message: item.failure.message } : { reason: item.failure.message }),
          body: frameBody(item),
        }]
      }
      return []
    })
  const body: ReactNode = masterRows.length > 1
    ? (
      <PceToolMaster
        rows={masterRows}
        column="FILE"
        previewKind={t(model.titleKey)}
        closeLabel={t('pce.closePreview')}
        previewLabel={t('pce.preview')}
      />
    )
    : frames !== null
      ? (frames.items.length === 0
        ? <div className="pce-result">{summary}</div>
        : frames.items.map((item, index) => <Fragment key={index}>{frameBody(item)}</Fragment>))
      : (card !== null
        ? (
          <ReadCodeCard
            card={card}
            line={readCallLine(block)}
            action={revealFile === undefined
              ? (inspect === undefined ? undefined : <button type="button" className="pce-action" onClick={inspect}>{t('row.inspect')}</button>)
              : <button type="button" className="pce-action" onClick={() => { if (card.label !== undefined) revealFile(card.label) }}>{t('row.open')}</button>}
            openFile={openFile}
            t={t}
          />
        )
        : model.state === 'error'
          ? <div className="pce-error">{model.errorSummary ?? model.output ?? model.summary}</div>
          : <div className="pce-result">{model.output ?? model.summary}</div>)
  return (
    <PceRow
      kind="read"
      glyph="read"
      title={t(model.titleKey)}
      summary={summary}
      detail={card === null ? null : cardMeta(card, t) ?? null}
      state={state}
      stateLabel={pceStateLabel(state, t)}
      onOpenSummary={firstPath === undefined
        ? undefined
        : () => {
          if (firstLine === undefined) openFile(firstPath)
          else openFile(firstPath, { line: firstLine })
        }}
      body={body}
    />
  )
}

/** Registers the read tool's conversation row. */
export const readToolview = {
  name: 'read-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'read', locale: NS }, ReadRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'multi_read', locale: NS }, ReadRow)
    })
  },
}
