/**
 * Keyed `bash` conversation row: a settled or pending `commands` batch renders
 * one terminal block per element (each with its own exit pill, copy control,
 * and persisted elapsed time) plus detach rows for backgrounded or skipped
 * elements, while non-batch shell calls keep the single-exit terminal card.
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import clsx from 'clsx'
import {
  IconApiOutline14, IconChevronDownOutline14, IconDetachOutline12, IconInspectOutline12, StateDot, TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { bashFramesModel, type BashFramesModel, type FramesCard, type FramesCommand } from '../models/bash-frames-model.ts'
import {
  isSettledPersistentShellCall,
  isSpilledShellCall,
  localizeTerminalCardModel,
  terminalBlockLabels,
  terminalCardModel,
  terminalFailed,
} from '../models/terminal-card-model.ts'
import { formatToolBody, toolRowModel, type ToolRowState } from '../models/tool-call-model.ts'
import { CONVERSATION_NS as NS } from '../../locale.ts'
import css from './bash-row.module.css'

type BashRowProps = ToolCallViewProps & PropsLocale<'conversation'>

/**
 * Compact duration text from the conversation dictionary: one-decimal seconds
 * under ten, integer seconds to a minute, then minutes and hours.
 * @param ms - elapsed wall time in milliseconds.
 * @param t - the render site's conversation locale seat.
 * @returns the localized compact duration.
 */
export function durationText(ms: number, t: TranslateNS<'conversation'>): string {
  const seconds = ms / 1000
  if (seconds < 60) {
    const value = seconds < 10
      ? (Math.round(seconds * 10) / 10).toFixed(1)
      : String(Math.round(seconds))
    return t('bash.duration.seconds', { value })
  }
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return t('bash.duration.minutes', { value: String(minutes) })
  return t('bash.duration.hours', { value: String(Math.round(minutes / 60)) })
}

function leadingFor(state: ToolRowState) {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    // Running keeps the icon — the row sweep carries the in-flight signal.
    default: return <IconApiOutline14 size={14} />
  }
}

/** Visually hidden status — StateDot is aria-hidden; AT needs a text label. */
function stateStatus(state: ToolRowState, t: TranslateNS<'conversation'>): string | null {
  switch (state) {
    case 'running': return t('bash.running')
    case 'error': return t('bash.failed')
    case 'stopped': return t('bash.stopped')
    default: return null
  }
}

/** An element workdir as the prompt label wants it: absolute stays, relative joins the session workspace. */
function frameCwd(workdir: string | undefined, sessionCwd: string | undefined): string | undefined {
  if (workdir === undefined) return sessionCwd
  if (sessionCwd === undefined || workdir.startsWith('/') || /^[A-Za-z]:[/\\]/.test(workdir)) return workdir
  return resolveWorkspacePath(sessionCwd, workdir)
}

/** One settled foreground frame as its own terminal block. */
function FrameTerminal(props: {
  frame: FramesCard & { kind: 'foreground' }
  cwd: string | undefined
  labels: ReturnType<typeof terminalBlockLabels>
  t: TranslateNS<'conversation'>
}) {
  const { frame, cwd, labels, t } = props
  return (
    <TerminalBlock
      command={frame.command}
      cwd={frameCwd(frame.workdir, cwd)}
      output={frame.output}
      exitCode={frame.exitCode}
      signal={frame.signal}
      maxLines={Infinity}
      labels={labels}
      className={css.terminal}
      accessory={frame.durationMs !== undefined ? durationText(frame.durationMs, t) : undefined}
    />
  )
}

/** One live terminal card per element while the batch is still running. */
function PendingFrames(props: {
  frames: Extract<BashFramesModel, { kind: 'pending' }>
  cwd: string | undefined
  labels: ReturnType<typeof terminalBlockLabels>
  elapsed: string
}) {
  const { frames, cwd, labels, elapsed } = props
  return frames.commands.map((element, index) => (
    <PendingTerminal key={`${index}:${element.command}`} element={element} cwd={cwd} labels={labels} elapsed={elapsed} />
  ))
}

/** Settled batch cards: a terminal per foreground frame, a detach line each for
 *  backgrounded and skipped elements. */
function SettledFrames(props: {
  frames: Extract<BashFramesModel, { kind: 'settled' }>
  cwd: string | undefined
  labels: ReturnType<typeof terminalBlockLabels>
  t: TranslateNS<'conversation'>
}) {
  const { frames, cwd, labels, t } = props
  return frames.frames.map((frame, index) => {
    if (frame.kind === 'foreground') {
      return <FrameTerminal key={`${index}:${frame.command}`} frame={frame} cwd={cwd} labels={labels} t={t} />
    }
    return (
      <div key={`${index}:${frame.command}`} className={css.detached} data-detached={frame.kind}>
        {frame.kind === 'job'
          ? <IconDetachOutline12 className={css.detachedIcon} />
          : <StateDot state="warning" className={css.detachedDot} />}
        <div className={css.detachedBody}>
          <span className={css.detachedCommand}>{frame.command}</span>
          <span className={css.detachedLine}>
            {frame.kind === 'job'
              ? t('bash.backgrounded', { jobId: frame.jobId ?? '' })
              : t('bash.notRun', { reason: frame.reason ?? '' })}
          </span>
        </div>
      </div>
    )
  })
}

/** One pending frame: a live terminal card until its element settles. */
function PendingTerminal(props: {
  element: FramesCommand
  cwd: string | undefined
  labels: ReturnType<typeof terminalBlockLabels>
  elapsed: string
}) {
  const { element, cwd, labels, elapsed } = props
  return (
    <TerminalBlock
      command={element.command}
      cwd={frameCwd(element.workdir, cwd)}
      running
      maxLines={Infinity}
      labels={labels}
      className={css.terminal}
      accessory={elapsed}
    />
  )
}

/** Renders Bash output: batched frames one card each, else the single-exit card. */
export function BashRow({ toolName, block, sessionId, useSessions, inspect, t }: BashRowProps) {
  const model = toolRowModel(toolName, block)
  // An omitted shell workdir is the session workspace; relative values resolve
  // against it before reaching the terminal primitive.
  const cwd = useSessions(list => list.byId[sessionId]?.cwd)
  const frames = useMemo(() => bashFramesModel(block), [block])
  const running = !('kind' in block)
  // Local component state: the running tick never leaves this row.
  const [elapsedMs, setElapsedMs] = useState(0)
  useEffect(() => {
    if (!running) return undefined
    const started = Date.now()
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - started)
    }, 100)
    return () => {
      clearInterval(interval)
    }
  }, [running])
  const labels = useMemo(() => terminalBlockLabels(t), [t])
  const terminalModel = frames === null ? terminalCardModel(block, cwd) : null
  const terminal = terminalModel === null ? null : localizeTerminalCardModel(terminalModel, t)
  const failedFrames = frames?.kind === 'settled' && frames.failed
  const state: ToolRowState = model.state === 'ok' && (failedFrames || (terminalModel !== null && terminalFailed(terminalModel)))
    ? 'error'
    : model.state
  const status = stateStatus(state, t)
  const [expanded, setExpanded] = useState(false)
  // Failures, persistent-shell results, and spill previews use a generic body;
  // background acknowledgements and malformed calls remain collapsed.
  const genericBody = frames === null && terminal === null
    && (model.state === 'error' || isSettledPersistentShellCall(block) || isSpilledShellCall(block))
    && (model.bodyRaw !== null || model.output !== null)
  const expandable = frames !== null || terminal !== null || genericBody
  const open = expanded && expandable
  const body = useMemo(
    () => open && genericBody && model.bodyRaw !== null
      ? formatToolBody(model.variant, model.bodyRaw)
      : null,
    [genericBody, model.bodyRaw, model.variant, open],
  )
  const failureLine = model.state === 'error' ? model.errorSummary : null
  const settledFor = 'kind' in block ? block.time - (block.callTime ?? block.time) : null
  const suffix = frames !== null
    ? running ? durationText(elapsedMs, t) : durationText(settledFor ?? 0, t)
    : null
  const toggleExpand = () => {
    setExpanded(v => !v)
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggleExpand()
  }
  const leading = open
    ? <IconChevronDownOutline14 className={css.chevron} />
    : expandable
      ? (
        <>
          <span className={css.iconIdle}>{leadingFor(state)}</span>
          <IconChevronDownOutline14 className={clsx(css.chevron, css.chevronHover)} />
        </>
      )
      : leadingFor(state)
  return (
    <div className={css.card}>
      <div
        className={css.root}
        data-sample="bash"
        data-variant="bash"
        data-state={state}
        data-expandable={expandable || undefined}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={expandable ? toggleExpand : undefined}
        onKeyDown={expandable ? toggleFromKeyboard : undefined}
      >
        <span className={css.leading}>{leading}</span>
        {status !== null && <span className={css.visuallyHidden}>{status}</span>}
        <span className={css.title}>{t(model.titleKey)}</span>
        <span className={css.sep} aria-hidden />
        <span className={clsx(css.summary, failureLine !== null && css.errorSummary)}>
          {failureLine ?? terminal?.description ?? model.summary}
        </span>
        {suffix !== null && <span className={css.suffix} data-live={running || undefined}>{suffix}</span>}
      </div>
      {open && (
        <div className={css.bodyWrap}>
          {frames !== null && (frames.kind === 'pending'
            ? <PendingFrames frames={frames} cwd={cwd} labels={labels} elapsed={durationText(elapsedMs, t)} />
            : <SettledFrames frames={frames} cwd={cwd} labels={labels} t={t} />)}
          {frames === null && terminal !== null && (
            <TerminalBlock
              {...terminal.card}
              maxLines={Infinity}
              labels={labels}
              className={css.terminal}
            />
          )}
          {frames === null && terminal === null && (
            <div className={css.ioCard}>
              {body !== null && (
                <div className={css.ioSection}>
                  <span className={css.ioLabel}>{t('row.input')}</span>
                  <span className={css.ioText}>{body}</span>
                </div>
              )}
              {body !== null && model.output !== null && (
                <span className={css.ioDivider} aria-hidden />
              )}
              {model.output !== null && (
                <div className={css.ioSection}>
                  <span className={css.ioLabel}>{t('row.output')}</span>
                  <span className={css.ioText} data-error={state === 'error' || undefined}>
                    {model.output}
                  </span>
                </div>
              )}
            </div>
          )}
          {inspect !== undefined && (
            <button type="button" className={css.inspectButton} onClick={inspect}>
              <IconInspectOutline12 />
              {t('row.inspect')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Registers the batched-and-fallback Bash conversation row. */
export const bashToolview = {
  name: 'bash-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: 'bash', locale: NS }, BashRow))
  },
}
