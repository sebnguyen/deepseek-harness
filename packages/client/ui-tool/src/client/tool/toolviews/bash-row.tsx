/**
 * Keyed `bash` conversation row: the proposed chat element head (pixel mark,
 * identity, state, toggle) over one pce terminal block per batched element or
 * the single-exit block. Detach rows keep their own line for backgrounded and
 * skipped elements, and the generic input/output card remains the fallback for
 * failures, persistent shells, and spilled output.
 */
import { useMemo } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { PceRow, PceToolMaster, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { bashFramesModel, type BashFramesModel, type FramesCard, type FramesCommand } from '../models/bash-frames-model.ts'
import {
  isSettledPersistentShellCall,
  isSpilledShellCall,
  localizeTerminalCardModel,
  terminalCardModel,
  terminalFailed,
} from '../models/terminal-card-model.ts'
import { formatToolBody, toolRowModel, type ToolRowState } from '../models/tool-call-model.ts'
import { pceStateLabel } from '../components/pce-label.ts'
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

/** An element workdir as the prompt label wants it: absolute stays, relative joins the session workspace. */
function frameCwd(workdir: string | undefined, sessionCwd: string | undefined): string | undefined {
  if (workdir === undefined) return sessionCwd
  if (sessionCwd === undefined || workdir.startsWith('/') || /^[A-Za-z]:[/\\]/.test(workdir)) return workdir
  return resolveWorkspacePath(sessionCwd, workdir)
}

/** The last path segment, as the terminal banner's working-directory label. */
function cwdLabel(path: string | undefined): string | undefined {
  if (path === undefined || path === '') return undefined
  const trimmed = path.replace(/[/\\]+$/, '')
  return trimmed.split(/[/\\]/).pop() ?? trimmed
}

/** One rendered terminal line of a pce block. */
interface TerminalLine {
  text: string
  tone?: 'command' | 'error' | undefined
  /** Prompt marker for a command row (`$` or `[i/N] $`). */
  gutter?: string | undefined
  /** Wire acknowledgement kind; renders as a detach line. */
  detached?: 'job' | 'not-run' | undefined
}

/** Split a command into one prompt row per line, as the terminal prints it. */
function commandLines(command: string, gutter: string): TerminalLine[] {
  const body = command.endsWith('\n') ? command.slice(0, -1) : command
  return body.split('\n').map(text => ({ tone: 'command', gutter, text }))
}

/** Split captured output into rendered lines (a final terminator is not a blank line). */
function outputLines(output: string | undefined): TerminalLine[] {
  if (output === undefined || output === '') return []
  const body = output.endsWith('\n') ? output.slice(0, -1) : output
  return body.split('\n').map(text => ({ text }))
}

/** Non-clean settle copy for a terminal block; absent for a clean exit. */
function exitLine(exitCode: number | undefined, signal: string | undefined, t: TranslateNS<'conversation'>): TerminalLine | null {
  if (signal !== undefined) return { tone: 'error', text: t('terminal.signal', { signal }) }
  if (exitCode !== undefined && exitCode !== 0) return { tone: 'error', text: t('terminal.exitCode', { code: exitCode }) }
  return null
}

/** One pce terminal block: a mono banner plus pre-wrap command/output lines. */
function PceTerminal(props: {
  lines: readonly TerminalLine[]
  running: boolean
  state: ToolRowState
  cwd?: string | undefined
  meta?: string | null | undefined
  inspect?: (() => void) | undefined
  t: TranslateNS<'conversation'>
}) {
  const { lines, running, state, cwd, meta, inspect, t } = props
  const dot = state === 'running' ? 'ongoing' : state === 'error' ? 'error' : state === 'stopped' ? 'warning' : 'done'
  return (
    <div className="pce-terminal" data-terminal="" data-running={running ? '' : undefined}>
      <div className="pce-terminal-head">
        <span>terminal</span>
        <StateDot state={dot} />
        <span className={css.visuallyHidden}>
          {state === 'ok' ? t('terminal.done') : state === 'error' ? t('terminal.failed') : t('terminal.running')}
        </span>
        {running && <span className="pce-running">{t('terminal.running')}</span>}
        {cwd !== undefined && <span className="pce-terminal-cwd">{cwd}</span>}
        {meta !== undefined && meta !== null && <span className="pce-terminal-meta">{meta}</span>}
        {inspect !== undefined && (
          <button type="button" className="pce-action" onClick={inspect}>{t('row.inspect')}</button>
        )}
      </div>
      {lines.map((line, index) => (
        <div
          key={`${index}:${line.text}`}
          className={[
            'pce-line',
            line.tone === 'command' ? 'is-command' : '',
            line.tone === 'error' ? 'is-error' : '',
          ].filter(Boolean).join(' ')}
          data-detached={line.detached}
        >
          {line.gutter !== undefined && <span className="pce-gutter" aria-hidden="true">{line.gutter}</span>}
          <span className="pce-line-text">{line.text}</span>
        </div>
      ))}
    </div>
  )
}

/** One live terminal block per element while a batch is still running. */
function PendingFrames(props: {
  frames: Extract<BashFramesModel, { kind: 'pending' }>
  cwd: string | undefined
  t: TranslateNS<'conversation'>
}) {
  const { frames, cwd, t } = props
  return frames.commands.map((element: FramesCommand, index) => (
    <PceTerminal
      key={`${index}:${element.command}`}
      running
      state="running"
      cwd={cwdLabel(frameCwd(element.workdir, cwd))}
      lines={commandLines(element.command, '$')}
      t={t}
    />
  ))
}

/** One settled block per foreground frame, plus a detach line for the others. */
function SettledFrames(props: {
  frames: Extract<BashFramesModel, { kind: 'settled' }>
  cwd: string | undefined
  inspect: (() => void) | undefined
  t: TranslateNS<'conversation'>
}) {
  const { frames, cwd, inspect, t } = props
  const total = frames.frames.length
  const blocks = frames.frames.map((frame: FramesCard, index) => {
    const gutter = `[${index + 1}/${total}] $`
    const meta = frame.kind === 'foreground' && frame.durationMs !== undefined
      ? durationText(frame.durationMs, t)
      : null
    if (frame.kind === 'foreground') {
      const exit = exitLine(frame.exitCode, frame.signal, t)
      return (
        <PceTerminal
          key={`${index}:${frame.command}`}
          running={false}
          state={exit === null ? 'ok' : 'error'}
          cwd={cwdLabel(frameCwd(frame.workdir, cwd))}
          meta={meta}
          inspect={index === 0 ? inspect : undefined}
          lines={[...commandLines(frame.command, gutter), ...outputLines(frame.output), ...exit === null ? [] : [exit]]}
          t={t}
        />
      )
    }
    const detached: TerminalLine = {
      text: frame.kind === 'job'
        ? t('bash.backgrounded', { jobId: frame.jobId ?? '' })
        : t('bash.notRun', { reason: frame.reason ?? '' }),
      detached: frame.kind,
    }
    return (
      <PceTerminal
        key={`${index}:${frame.command}`}
        running={false}
        state={frame.kind === 'job' ? 'ok' : 'stopped'}
        inspect={index === 0 ? inspect : undefined}
        lines={[...commandLines(frame.command, gutter), detached]}
        t={t}
      />
    )
  })
  if (total <= 1) return blocks
  return (
    <PceToolMaster
      column="COMMAND"
      previewKind="Terminal"
      closeLabel={t('pce.closePreview')}
      previewLabel={t('pce.preview')}
      rows={frames.frames.map((frame, index) => {
        const foreground = frame.kind === 'foreground'
        const failed = foreground && (frame.exitCode !== undefined || frame.signal !== undefined)
        return {
          tone: failed ? 'error' : frame.kind === 'not-run' ? 'stopped' : 'ok',
          state: failed ? t('terminal.failed') : frame.kind === 'not-run' ? t('row.stopped') : t('terminal.done'),
          primary: frame.command,
          detail: foreground
            ? [
              frame.durationMs === undefined ? null : durationText(frame.durationMs, t),
              failed ? exitLine(frame.exitCode, frame.signal, t)?.text ?? null : null,
            ].filter((part): part is string => part !== null).join(' · ')
            : frame.kind === 'job'
              ? t('bash.backgrounded', { jobId: frame.jobId ?? '' })
              : t('bash.notRun', { reason: frame.reason ?? '' }),
          body: blocks[index],
        }
      })}
    />
  )
}

/** The single-exit terminal block for a non-batch shell call. */
function SingleTerminal(props: {
  localized: ReturnType<typeof localizeTerminalCardModel>
  state: ToolRowState
  inspect: (() => void) | undefined
  t: TranslateNS<'conversation'>
}) {
  const { localized, state, inspect, t } = props
  const { card } = localized
  const running = card.running === true
  const exit = exitLine(card.exitCode, card.signal, t)
  const lines = running
    ? commandLines(card.command, '$')
    : [...commandLines(card.command, '$'), ...outputLines(card.output), ...exit === null ? [] : [exit]]
  return (
    <PceTerminal
      running={running}
      state={state}
      cwd={cwdLabel(card.cwd)}
      inspect={inspect}
      lines={lines}
      t={t}
    />
  )
}

/** Renders Bash output: pce terminal blocks over the proposed chat element head. */
export function BashRow({ toolName, block, sessionId, useSessions, inspect, t, rowMarks }: BashRowProps) {
  const model = toolRowModel(toolName, block)
  // An omitted shell workdir is the session workspace; relative values resolve
  // against it before reaching the terminal block.
  const cwd = useSessions(list => list.byId[sessionId]?.cwd)
  const frames = useMemo(() => bashFramesModel(block), [block])
  const running = !('kind' in block)
  const terminalModel = frames === null ? terminalCardModel(block, cwd) : null
  const terminal = terminalModel === null ? null : localizeTerminalCardModel(terminalModel, t)
  const failedFrames = frames?.kind === 'settled' && frames.failed
  const state: ToolRowState = model.state === 'ok' && (failedFrames || (terminalModel !== null && terminalFailed(terminalModel)))
    ? 'error'
    : model.state
  // Failures, persistent-shell results, and spill previews use the generic
  // input/output body; background acknowledgements stay on the result body.
  const genericBody = frames === null && terminal === null
    && (model.state === 'error' || isSettledPersistentShellCall(block) || isSpilledShellCall(block))
    && (model.bodyRaw !== null || model.output !== null)
  const body = useMemo(() => {
    if (frames !== null) {
      return frames.kind === 'pending'
        ? <PendingFrames frames={frames} cwd={cwd} t={t} />
        : <SettledFrames frames={frames} cwd={cwd} inspect={inspect} t={t} />
    }
    if (!genericBody && terminal !== null && terminalModel !== null) {
      return <SingleTerminal localized={terminal} state={state} inspect={inspect} t={t} />
    }
    if (genericBody) {
      const input = model.bodyRaw === null ? null : formatToolBody(model.variant, model.bodyRaw)
      return (
        <div className={css.ioCard}>
          {input !== null && (
            <div className={css.ioSection}>
              <span className={css.ioLabel}>{t('row.input')}</span>
              <span className={css.ioText}>{input}</span>
            </div>
          )}
          {input !== null && model.output !== null && <span className={css.ioDivider} aria-hidden />}
          {model.output !== null && (
            <div className={css.ioSection}>
              <span className={css.ioLabel}>{t('row.output')}</span>
              <span className={css.ioText} data-error={state === 'error' || undefined}>{model.output}</span>
            </div>
          )}
        </div>
      )
    }
    return <div className="pce-result">{model.output ?? model.summary}</div>
  }, [cwd, frames, genericBody, inspect, model.bodyRaw, model.output, model.summary, model.variant, state, t, terminal, terminalModel])
  const failureLine = model.state === 'error' ? model.errorSummary : null
  const settledFor = 'kind' in block ? block.time - (block.callTime ?? block.time) : null
  const suffix = frames !== null && !running ? durationText(settledFor ?? 0, t) : null
  return (
    <PceRow
      kind="bash"
      glyph="bash"
      title={t(model.titleKey)}
      summary={failureLine ?? terminal?.description ?? model.summary}
      detail={suffix}
      state={state}
      stateLabel={pceStateLabel(state, t)}
      marks={rowMarks !== false}
      body={body}
    />
  )
}

/** Registers the batched-and-fallback Bash conversation row. */
export const bashToolview = {
  name: 'bash-toolview',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', function* () {
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'bash', locale: NS }, BashRow)
      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'multi_bash', locale: NS }, BashRow)
    })
  },
}
