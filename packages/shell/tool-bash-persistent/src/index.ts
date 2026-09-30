/**
 * Model-facing persistent `bash` tool over the owner-scoped PTY seam.
 * @module @deepseek-ai/dsh-tool-bash-persistent
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobHooks, JobOutcome, JobOutputLines } from '@deepseek-ai/dsh-jobs'
import type { TerminalReadResult, TerminalSendOperation, TerminalSendResult, TerminalSessionId } from '@deepseek-ai/dsh-terminal'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { defineTool } from '@deepseek-ai/dsh-tools'

// TODO: Replace the file-search advice; arbitrary command output need not come from a searchable file.
const TRUNCATED_MESSAGE = '<response clipped><NOTE>To save on context only part of this file has been shown to you. You should retry this tool after you have searched inside the file with `grep -n` in order to find the line numbers of what you are looking for.</NOTE>'
const LOST_PREFIX_MESSAGE = '<response clipped><NOTE>The beginning of this command output was dropped by the terminal scrollback limit. The following text is the earliest retained output.</NOTE>\n'
const SHELL_RESET_MESSAGE = 'The persistent bash shell was reset; the next bash call starts from the workspace with a fresh current directory and environment.'
// Status trailer for a command that never reported an exit code; settled
// commands append `[Command finished with exit code N]` instead (see renderCaptured).
const TIMEOUT_STATUS_MARKER = '[Command timed out or OOM]'
const TIMEOUT_CODE = 'PERSISTENT_BASH_TIMEOUT'
// One page is enough to find a just-emitted completion marker; the full
// scrollback is assembled only when a command settles or needs partial output.
const SCROLLBACK_PAGE_LINES = 1_000
const POLL_INTERVAL_MS = 25

const DEFAULT_DESCRIPTION = 'Run commands in a persistent bash shell. State, including the current directory and exported environment variables, persists across calls for this agent.'

interface ResolvedConfig {
  backendType: string
  timeoutMs: number
  maxOutputChars: number
  description: string
  enableRunInBackground: boolean
  backgroundAfterMs: number
  contentionAfterMs: number
}

interface CommandMarkers {
  start: string
  end: string
}

interface RetainedOutput {
  text: string
  truncated: boolean
}

interface CapturedOutput {
  text: string
  incomplete: boolean
  exitCode?: number
}

interface PersistentShells {
  get(owner: Agent, signal: AbortSignal): Promise<TerminalSessionId>
  reset(owner: Agent, reason: string): Promise<void>
  /** Hand a live session to an adopting job without closing it. */
  retire(owner: Agent, id: TerminalSessionId): void
}

/** Parsed tool args; `run_in_background` is enforced in execute even when unadvertised. */
interface BashArgs {
  command: string
  run_in_background?: boolean
}

function maybeTruncate(content: string, maxOutputChars: number, incomplete = false): string {
  if (content.length <= maxOutputChars && !incomplete) return content
  return content.length <= maxOutputChars
    ? content + TRUNCATED_MESSAGE
    : content.slice(0, maxOutputChars) + TRUNCATED_MESSAGE
}

function markers(): CommandMarkers {
  const nonce = randomUUID()
  return {
    start: `__DSH_PERSISTENT_BASH_START_${nonce}__`,
    end: `__DSH_PERSISTENT_BASH_END_${nonce}:`,
  }
}

function quoteForBash(value: string): string {
  return `$'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')}'`
}

function wrapCommand(command: string, marker: CommandMarkers): string {
  // Keep the wrapper on one physical line. An interactive bash prints PS2 for
  // embedded newlines before executing the buffer, which would leak terminal
  // prompts and marker source text into the model-facing result.
  return `printf '%s\\n' ${quoteForBash(marker.start)}; eval -- ${quoteForBash(command)}; __dsh_persistent_bash_status=$?; printf '%s%s\\n' ${quoteForBash(marker.end)} "$__dsh_persistent_bash_status"`
}

function trimTrailingNewline(text: string): string {
  return text.replace(/(?:\r?\n)+$/, '')
}

function commandOutput(
  snapshot: RetainedOutput,
  marker: CommandMarkers,
): CapturedOutput | undefined {
  const text = snapshot.text
  const end = text.lastIndexOf(marker.end)
  const status = /^(\d+)\r?\n/.exec(text.slice(end + marker.end.length))?.[1]
  if (status === undefined) return undefined
  const startMarker = text.lastIndexOf(marker.start, end)
  const start = startMarker < 0 ? 0 : startMarker + marker.start.length
  return {
    text: trimTrailingNewline(text.slice(start, end).replace(/^\r?\n/, '')),
    incomplete: startMarker < 0,
    exitCode: Number(status),
  }
}

function partialOutput(
  snapshot: RetainedOutput,
  marker: CommandMarkers,
  fallback: string,
  fallbackTruncated = false,
): CapturedOutput {
  const startMarker = snapshot.text.lastIndexOf(marker.start)
  if (startMarker >= 0) {
    return {
      text: trimTrailingNewline(snapshot.text.slice(startMarker + marker.start.length).replace(/^\r?\n/, '')),
      incomplete: false,
    }
  }
  const fallbackStart = fallback.lastIndexOf(marker.start)
  const afterStart = fallbackStart < 0
    ? fallback
    : fallback.slice(fallbackStart + marker.start.length).replace(/^\r?\n/, '')
  const fallbackEnd = afterStart.lastIndexOf(marker.end)
  const beforeEnd = fallbackEnd < 0 ? afterStart : afterStart.slice(0, fallbackEnd)
  return {
    text: trimTrailingNewline(beforeEnd),
    incomplete: fallbackTruncated || fallbackStart < 0,
  }
}

async function pause(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
}

function nextScrollbackOffset(page: TerminalReadResult, offset: number): number | undefined {
  if (page.text.length === 0 || page.lineEnd <= offset) return undefined
  return page.lineEnd
}

function retainedScrollback(
  ctx: Context,
  owner: Agent,
  id: TerminalSessionId,
  latest = ctx.terminals.read(owner, id, { offset: 0, count: SCROLLBACK_PAGE_LINES }),
): RetainedOutput {
  const pages: string[] = latest.text.length === 0 ? [] : [latest.text]
  let offset = latest.lineEnd
  let truncated = latest.truncated
  while (true) {
    if (offset >= latest.totalLines) break
    const page = ctx.terminals.read(owner, id, { offset, count: SCROLLBACK_PAGE_LINES })
    truncated ||= page.truncated
    if (page.text.length > 0) pages.unshift(page.text)
    const next = nextScrollbackOffset(page, offset)
    if (next === undefined || next >= page.totalLines) break
    offset = next
  }
  return { text: pages.join('\n'), truncated }
}

function renderCaptured(output: CapturedOutput, maxOutputChars: number): string {
  const rendered = maybeTruncate(output.text, maxOutputChars, output.incomplete)
  const withPrefix = output.incomplete && output.text.length > 0
    ? LOST_PREFIX_MESSAGE + rendered
    : rendered
  const marker = output.exitCode !== undefined
    ? `[Command finished with exit code ${output.exitCode}]`
    : undefined
  return appendStatusMarker(withPrefix, marker)
}

function appendStatusMarker(content: string, marker: string | undefined): string {
  if (marker === undefined) return content
  return content.length === 0 ? marker : `${content}\n${marker}`
}

function renderShellExitStatus(
  content: string,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): string {
  const marker = signal !== null
    ? `[shell killed by signal: ${signal}]`
    : exitCode !== null
      ? `[shell exited: code ${exitCode}]`
      : '[shell exited]'
  return appendStatusMarker(content, marker)
}

/**
 * Render the exited-session result, reset the owner's shell, and reset the
 * message that tells the model the next call starts fresh.
 * @param shells - the owner-scoped registry to reset.
 * @param status - the exited session status (exit code and signal).
 * @returns the complete model-facing result.
 */
async function respondToSessionExit(
  ctx: Context,
  shells: PersistentShells,
  owner: Agent,
  id: TerminalSessionId,
  status: { exitCode: number | null; signal: NodeJS.Signals | null },
  marker: CommandMarkers,
  fallback: string,
  fallbackTruncated: boolean,
  config: ResolvedConfig,
): Promise<string> {
  const snapshot = retainedScrollback(ctx, owner, id)
  await shells.reset(owner, 'persistent bash shell exited')
  return [
    renderShellExitStatus(
      renderCaptured(partialOutput(snapshot, marker, fallback, fallbackTruncated), config.maxOutputChars),
      status.exitCode,
      status.signal,
    ),
    SHELL_RESET_MESSAGE,
  ].filter(part => part.length > 0).join('\n')
}

function persistentShells(ctx: Context, config: ResolvedConfig): PersistentShells {
  const pending = new WeakMap<Agent, Promise<TerminalSessionId>>()
  const live = new Map<Agent, TerminalSessionId>()
  const creating = new Set<Promise<TerminalSessionId>>()
  const ownerCleanupInstalled = new WeakSet<Agent>()
  const lifecycle = new AbortController()

  const close = async (owner: Agent, id: TerminalSessionId, reason: string): Promise<void> => {
    if (!ctx.terminals.list(owner).some(snapshot => snapshot.sessionId === id)) return
    await ctx.terminals.kill(owner, id, reason)
  }

  ctx.effect(() => async () => {
    lifecycle.abort(new Error('tool-bash-persistent disposed during shell creation'))
    await Promise.allSettled([...creating])
    const closing = [...live].map(async ([owner, id]) => { await close(owner, id, 'tool-bash-persistent disposed') })
    await Promise.all(closing)
    live.clear()
  }, 'tool-bash-persistent shell cleanup')

  const reset = async (owner: Agent, reason: string): Promise<void> => {
    pending.delete(owner)
    const id = live.get(owner)
    live.delete(owner)
    if (id !== undefined) await close(owner, id, reason)
  }

  // Hand a live session to an adopting job: the agent stops being served this
  // shell, and closure moves to the adopter. Retirement is deliberately not
  // `reset` — reset kills the session, which would destroy the very command
  // the job is taking over.
  const retire = (owner: Agent, id: TerminalSessionId): void => {
    if (live.get(owner) === id) live.delete(owner)
    pending.delete(owner)
  }

  const get = (owner: Agent, signal: AbortSignal): Promise<TerminalSessionId> => {
    const existing = pending.get(owner)
    if (existing !== undefined) return existing
    const combinedSignal = AbortSignal.any([signal, lifecycle.signal])
    const creation = (async () => {
      try {
        const cwd = owner.session.header.cwd
        const spawned = await ctx.terminals.spawn(owner, {
          type: config.backendType,
          ...cwd === undefined ? {} : { cwd },
        }, combinedSignal)
        live.set(owner, spawned.sessionId)
        if (!ownerCleanupInstalled.has(owner)) {
          ownerCleanupInstalled.add(owner)
          owner.ctx.effect(() => () => {
            pending.delete(owner)
            live.delete(owner)
          }, 'tool-bash-persistent owner cache cleanup')
        }
        // Echo suppression only: the prompt stays the backend's own, so the
        // backend's prompt-based readiness detection keeps working.
        const setup = ctx.terminals.startSend(owner, spawned.sessionId, {
          text: 'stty -echo',
          submit: true,
          signal: combinedSignal,
        })
        const result = await setup.done
        if (result.sessionStatus.kind === 'exited' || result.waitReason === 'timeout') {
          throw new Error('persistent bash shell did not accept initialization')
        }
        return spawned.sessionId
      } catch (error: unknown) {
        await reset(owner, 'persistent bash initialization failed')
        throw error
      }
    })()
    const tracked = creation.finally(() => {
      creating.delete(tracked)
    })
    creating.add(tracked)
    pending.set(owner, tracked)
    return tracked
  }

  return { get, reset, retire }
}

/** Sentinel resolving a promotion race when the threshold wins. */
const PROMOTION_DUE = Symbol('promotion-due')
const CONTENTION_WAITING = Symbol('contention-waiting')

/**
 * A second call's arrival for the same owner's shell. Promotion still decides
 * whether the holder surrenders, because the backend allows one active send per
 * session: the holder keeps its observation and re-races at a lower bar.
 */
interface ShellContention {
  /** Resolves once another call queues behind this command's shell. */
  readonly waiting: Promise<typeof CONTENTION_WAITING>
  /** Detaches the subscription when the command stops observing. */
  readonly release: () => void
}

/**
 * Subscribe to the next call that queues behind `owner`'s running command.
 * @param listeners - per-owner listener registry owned by the registration.
 * @param owner - the agent whose shell is contended.
 * @returns the waiting signal and the disposer that removes it.
 */
function watchContention(listeners: WeakMap<Agent, Set<() => void>>, owner: Agent): ShellContention {
  let notify: () => void = () => {}
  const waiting = new Promise<typeof CONTENTION_WAITING>((resolve) => {
    notify = () => { resolve(CONTENTION_WAITING) }
  })
  const held = listeners.get(owner) ?? new Set<() => void>()
  held.add(notify)
  listeners.set(owner, held)
  return {
    waiting,
    release: () => {
      held.delete(notify)
      if (held.size === 0) listeners.delete(owner)
    },
  }
}

/**
 * Resolve after `ms`, carrying the promotion sentinel.
 * @param ms - delay in milliseconds.
 * @returns the promotion sentinel once the delay elapses.
 */
async function delay(ms: number): Promise<typeof PROMOTION_DUE> {
  await new Promise(resolve => setTimeout(resolve, ms))
  return PROMOTION_DUE
}

/**
 * Retire an in-flight foreground command into a background job. The command is
 * already running in `sessionId`, so nothing is moved: the job takes over
 * observation, completion, and closure of a shell the agent stops being served.
 *
 * Registration happens before retirement. A registry refusal — the owner's job
 * limit, or no attached controller — leaves the command running in the agent's
 * own shell, which is why this reports the refusal instead of retiring first
 * and leaving the agent with neither a shell nor a job.
 * @param ctx - plugin context carrying the job registry.
 * @param shells - the owner's shell registry.
 * @param owner - the agent that owns both the shell and the new job.
 * @param sessionId - the shell running the adopted command.
 * @param marker - the completion markers of the adopted command.
 * @param command - the command text, used as the job label.
 * @param config - resolved tool configuration.
 * @returns the model-facing acknowledgement, or undefined when the registry refused.
 */
function promoteInFlight(
  ctx: Context,
  shells: PersistentShells,
  owner: Agent,
  sessionId: TerminalSessionId,
  marker: CommandMarkers,
  command: string,
  config: ResolvedConfig,
  reason: 'threshold' | 'contention',
): string | undefined {
  const jobs = ctx.get('jobs')
  if (jobs === undefined) return undefined
  let jobId: string
  try {
    jobId = jobs.start({
      kind: 'bash',
      label: command,
      owner,
      run: () => backgroundCommandHooks(ctx, owner, command, config, { sessionId, marker }),
    })
  } catch {
    return undefined
  }
  shells.retire(owner, sessionId)
  const threshold = config.backgroundAfterMs >= 1_000
    ? `${String(Math.round(config.backgroundAfterMs / 1_000))}s`
    : `${String(config.backgroundAfterMs)}ms`
  const cause = reason === 'contention'
    ? 'A newer command needs this shell'
    : `This command exceeded ${threshold}`
  return [
    `${cause}, so it was moved to the background as job ${jobId}.`,
    SHELL_RESET_MESSAGE,
    'Read its output with job_output.',
  ].join('\n')
}

async function executeCommand(
  ctx: Context,
  shells: PersistentShells,
  owner: Agent,
  command: string,
  config: ResolvedConfig,
  upstream: AbortSignal,
  contention: ShellContention | undefined,
): Promise<string> {
  using commandDeadline = deadline(upstream, config.timeoutMs, TIMEOUT_CODE)
  const id = await shells.get(owner, commandDeadline.signal)
  const marker = markers()
  const wrapped = wrapCommand(command, marker)
  let first = true
  let fallback = ''
  let fallbackTruncated = false
  // Promotion is measured from the command's start, not from the current send:
  // a quiet command's send settles on each backend silence window, and
  // restarting the clock per iteration would never reach the threshold.
  const startedAt = Date.now()
  let promotionActive = config.backgroundAfterMs > 0
  // Contention lowers the bar rather than removing it: a command young enough
  // to finish before the floor is left in the foreground for its caller.
  let threshold = config.backgroundAfterMs
  const contentionSignal = contention?.waiting
  let contentionArmed = promotionActive && contentionSignal !== undefined
  // A send the promotion race abandoned. The terminal session allows one
  // active send, so a refused promotion resumes this observation instead of
  // starting a second one, which the backend would reject.
  let abandoned: TerminalSendOperation | undefined

  while (true) {
    // The shell may flip to exited between iterations (a fast `exit` can
    // settle the previous send while its exit event is still in flight);
    // re-observing status before the next send closes that gap.
    const status = ctx.terminals.list(owner).find(session => session.sessionId === id)?.status
    if (status?.kind === 'exited') {
      return await respondToSessionExit(
        ctx, shells, owner, id, status, marker, fallback, fallbackTruncated, config,
      )
    }
    let operation
    let result
    try {
      operation = abandoned
      abandoned = undefined
      if (operation === undefined) {
        operation = ctx.terminals.startSend(owner, id, {
          text: first ? wrapped : '',
          submit: first,
          signal: commandDeadline.signal,
        })
        first = false
      }
      // Racing the send against the threshold abandons only this tool's
      // observation: it sends no signal, so the command keeps running for the
      // job that adopts the shell.
      let settled: TerminalSendResult | typeof PROMOTION_DUE | typeof CONTENTION_WAITING = undefined as never
      let reason: 'threshold' | 'contention' = 'threshold'
      while (true) {
        const remaining = promotionActive
          ? Math.max(0, threshold - (Date.now() - startedAt))
          : Number.POSITIVE_INFINITY
        const contenders: Promise<unknown>[] = [operation.done]
        if (Number.isFinite(remaining)) contenders.push(delay(remaining))
        if (contentionArmed && contentionSignal !== undefined) contenders.push(contentionSignal)
        settled = contenders.length === 1
          ? await operation.done
          : await Promise.race(contenders) as TerminalSendResult | typeof PROMOTION_DUE | typeof CONTENTION_WAITING
        if (settled !== CONTENTION_WAITING) break
        contentionArmed = false
        reason = 'contention'
        threshold = Math.min(threshold, config.contentionAfterMs)
      }
      if (settled === PROMOTION_DUE) {
        const promoted = promoteInFlight(ctx, shells, owner, id, marker, command, config, reason)
        if (promoted !== undefined) {
          void operation.done.catch(() => {
            // The abandoned send settles later; its outcome belongs to the job.
          })
          return promoted
        }
        // The registry refused: this shell still owns a running command, so
        // resume observing the send already in flight rather than killing it
        // or starting a second one the backend would reject.
        promotionActive = false
        abandoned = operation
        continue
      }
      result = settled
    } catch (error: unknown) {
      await shells.reset(owner, 'persistent bash send failed')
      throw error
    }
    const incremental = operation.readOutput()
    fallback = incremental.delta.length > 0 ? fallback + incremental.delta : result.viewport
    fallbackTruncated ||= incremental.truncated || result.truncated
    const latest = ctx.terminals.read(owner, id, { offset: 0, count: SCROLLBACK_PAGE_LINES })
    const timedOut = timeoutOf(commandDeadline.signal, TIMEOUT_CODE)
    if (timedOut !== undefined) {
      const snapshot = retainedScrollback(ctx, owner, id, latest)
      const partial = renderCaptured(
        partialOutput(snapshot, marker, fallback, fallbackTruncated),
        config.maxOutputChars,
      )
      await shells.reset(owner, 'persistent bash command timed out')
      return [
        // TODO: Report a timeout only; this signal does not establish an OOM.
        `Your command timed out after ${Math.round(timedOut.timeoutMs / 1000)} seconds or experienced an OOM error. Below is partial output:`,
        appendStatusMarker(partial, TIMEOUT_STATUS_MARKER),
        SHELL_RESET_MESSAGE,
      ].join('\n')
    }
    if (commandDeadline.signal.aborted) {
      await shells.reset(owner, 'persistent bash command aborted')
      commandDeadline.signal.throwIfAborted()
    }
    if (latest.text.includes(marker.end)) {
      const complete = commandOutput(retainedScrollback(ctx, owner, id, latest), marker)
      if (complete !== undefined) return renderCaptured(complete, config.maxOutputChars)
    }
    if (result.sessionStatus.kind === 'exited') {
      return await respondToSessionExit(
        ctx, shells, owner, id, result.sessionStatus, marker, fallback, fallbackTruncated, config,
      )
    }
    // The shell reads stdin again (its prompt, or a foreground child's own
    // read) without having printed the end marker — e.g. `exec`, an interrupt,
    // or an interactive child. Return what was captured instead of spinning
    // until the command deadline.
    if (result.waitReason === 'stdin_read') {
      const snapshot = retainedScrollback(ctx, owner, id, latest)
      return renderCaptured(
        partialOutput(snapshot, marker, fallback, fallbackTruncated),
        config.maxOutputChars,
      )
    }
    await pause()
  }
}

/**
 * Start one background command in its own PTY session and return the hooks the
 * job registry drives. The agent's persistent shell is untouched: a background
 * command runs in a fresh shell, so it neither inherits the agent's current
 * directory and environment nor occupies the shell the next `bash` call uses.
 *
 * The command is wrapped with the same completion markers the foreground path
 * uses, so a settled command's exit code is read from the marker line rather
 * than from the session's lifetime. Reads are served from scrollback, which is
 * line-addressed and does not consume the session's own read cursor.
 * @param ctx - plugin context carrying the owner-scoped PTY service.
 * @param owner - the agent that owns the job and its shell.
 * @param command - the command text to run.
 * @param config - resolved tool configuration.
 * @returns hooks the registry consumes for output, completion, and cancellation.
 */
function backgroundCommandHooks(
  ctx: Context,
  owner: Agent,
  command: string,
  config: ResolvedConfig,
  adopt?: { sessionId: TerminalSessionId; marker: CommandMarkers },
): JobHooks {
  const marker = adopt?.marker ?? markers()
  const lifecycle = new AbortController()
  let sessionId: TerminalSessionId | undefined
  // A holder rather than a plain flag: the control-flow analysis cannot see
  // that `cancel` assigns it, so a `let` reads as always false.
  const state = { cancelled: false }
  let emitted = 0
  // Retained marker-free output. The session is released at settlement, so a
  // reader that arrives afterwards is served from this buffer rather than from
  // a scrollback that no longer exists.
  let captured = ''
  // Counters that keep `readLines` indices absolute while `captured`'s front moves.
  let lastLineCount = 0
  let droppedLines = 0

  const ready = (async (): Promise<void> => {
    // An adopted command is already running in a shell this job now owns; a
    // started one needs its own session and its own wrapped command.
    if (adopt !== undefined) {
      sessionId = adopt.sessionId
      return
    }
    const cwd = owner.session.header.cwd
    const spawned = await ctx.terminals.spawn(owner, {
      type: config.backendType,
      ...cwd === undefined ? {} : { cwd },
    }, lifecycle.signal)
    sessionId = spawned.sessionId
    const send = ctx.terminals.startSend(owner, spawned.sessionId, {
      text: wrapCommand(command, marker),
      submit: true,
      signal: lifecycle.signal,
    })
    await send.done
  })()

  const release = async (reason: string): Promise<void> => {
    const id = sessionId
    if (id === undefined) return
    try {
      await ctx.terminals.kill(owner, id, reason)
    } catch {
      // The backend already settled this session; teardown stays best-effort.
    }
  }

  const done: Promise<JobOutcome> = (async (): Promise<JobOutcome> => {
    try {
      await ready
    } catch (error: unknown) {
      await release('background bash command failed to start')
      if (state.cancelled) return { status: 'killed' }
      return { status: 'failed', detail: error instanceof Error ? error.message : String(error) }
    }
    const id = sessionId as TerminalSessionId
    while (true) {
      if (state.cancelled) {
        await release('background bash command cancelled')
        return { status: 'killed' }
      }
      const complete = commandOutput(retainedScrollback(ctx, owner, id), marker)
      if (complete !== undefined) {
        captured = complete.text
        await release('background bash command settled')
        // A nonzero command exit is reported, not failed, matching the
        // foreground rendering and the one-shot tool's outcome mapping.
        return { status: 'completed', detail: `exit code: ${complete.exitCode ?? 'unknown'}` }
      }
      captured = partialOutput(retainedScrollback(ctx, owner, id), marker, '').text
      const status = ctx.terminals.list(owner).find(session => session.sessionId === id)?.status
      if (status?.kind === 'exited') {
        await release('background bash shell exited')
        return { status: 'killed', detail: 'killed before exit' }
      }
      await pause()
    }
  })()

  return {
    // Synchronous and idempotent: the registry calls this from disposal and
    // from an explicit kill, so it must never await the asynchronous teardown.
    cancel: (reason?: string): void => {
      if (state.cancelled) return
      state.cancelled = true
      lifecycle.abort(new Error(reason ?? 'background bash command cancelled'))
      const id = sessionId
      if (id !== undefined) void ctx.terminals.kill(owner, id, reason ?? 'background bash command cancelled')
    },
    done,
    readOutput: (): string => {
      // Scrollback trimming, and the release at settlement, can both move the
      // retained text backwards; re-anchor instead of replaying what this
      // consumer already received.
      if (captured.length <= emitted) {
        emitted = captured.length
        return ''
      }
      const delta = captured.slice(emitted)
      emitted = captured.length
      return delta
    },
    // Absolute line indices over the command's own output, so a caller's
    // cursor survives the trimming that moves `captured`'s front backwards.
    readLines: (from: number): JobOutputLines => {
      const lines = captured.length === 0 ? [] : captured.replace(/\n$/, '').split('\n')
      if (lines.length < lastLineCount) droppedLines += lastLineCount - lines.length
      lastLineCount = lines.length
      const start = Math.max(from, droppedLines)
      return {
        lines: lines.slice(start - droppedLines),
        next: droppedLines + lines.length,
        truncated: from < droppedLines,
      }
    },
  }
}

/**
 * Register the model-facing persistent `bash` tool.
 * @param ctx - plugin context carrying tools and the owner-scoped PTY service.
 * @param config - selected PTY backend and command deadline.
 */
function registerPersistentBash(ctx: Context, config: ResolvedConfig): void {
  const shells = persistentShells(ctx, config)
  const queues = new WeakMap<Agent, Promise<void>>()
  const contentionListeners = new WeakMap<Agent, Set<() => void>>()

  const serialized = async <T>(owner: Agent, operation: () => Promise<T>): Promise<T> => {
    const prior = queues.get(owner)
    if (prior !== undefined) {
      // A second call is waiting for a shell this owner's command is holding.
      for (const notify of contentionListeners.get(owner) ?? []) notify()
    }
    const run = (prior ?? Promise.resolve()).then(operation, operation)
    const tail = run.then(() => undefined, () => undefined)
    queues.set(owner, tail)
    try {
      return await run
    } finally {
      if (queues.get(owner) === tail) queues.delete(owner)
    }
  }

  ctx.tools.register(defineTool({
    name: 'bash',
    description: config.description,
    parameters: {
      command: {
        type: 'string',
        required: true,
        description: 'The bash command to run. Relative path is preferred in the command.',
      },
      ...config.enableRunInBackground ? {
        run_in_background: {
          type: 'boolean' as const,
          description: 'Run the command in its own background shell and return a job id immediately '
            + '(collect with job_output, stop with job_kill). The command starts from the workspace rather '
            + 'than from this shell\'s state, keeps running with no timeout, and leaves this shell free for '
            + 'the next call.',
        },
      } : {},
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args: BashArgs, exec) {
      if (args.command.trim().length === 0) throw new Error('command must be a non-empty string')
      const owner = exec.agent
      if (owner === undefined) throw new Error('bash requires an owning agent session')
      if (args.run_in_background === true) {
        // Undeclared keys are allowed, so schema omission also needs enforcement.
        if (!config.enableRunInBackground) {
          throw new Error('run_in_background is disabled for this deployment (enableRunInBackground: false)')
        }
        const jobs = ctx.get('jobs')
        if (jobs === undefined) {
          throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
        }
        exec.signal.throwIfAborted()
        // Deliberately outside the per-owner queue: a background call returns
        // immediately instead of waiting for whatever command is running.
        const jobId = jobs.start({
          kind: 'bash',
          label: args.command,
          owner,
          run: () => backgroundCommandHooks(ctx, owner, args.command, config),
        })
        return `started background job ${jobId}`
      }
      return serialized(owner, async () => {
        exec.signal.throwIfAborted()
        // Armed before the command starts so a call arriving mid-command is
        // never lost to the ordering between queueing and observation.
        const contention = config.backgroundAfterMs > 0
          ? watchContention(contentionListeners, owner)
          : undefined
        try {
          return await executeCommand(ctx, shells, owner, args.command, config, exec.signal, contention)
        } finally {
          contention?.release()
        }
      })
    },
    presentCall: args => ({ card: 'terminal', title: args.command }),
  }))
}

export const name = 'tool-bash-persistent'
export const inject = ['tools', 'terminals']

/** Configuration for the persistent Bash tool. */
export interface Config {
  /** PTY backend used for each owner-isolated persistent shell (default `shell`). */
  backendType?: string
  /** Wall-clock limit for one command (default 300000). */
  timeoutMs?: number
  /** Maximum returned command-output characters before clipping (default 16000). */
  maxOutputChars?: number
  /** Model-facing tool description; deployments may describe their environment. */
  description?: string
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  enableRunInBackground?: boolean
  /**
   * Milliseconds a foreground command may run before it is retired into a
   * background job instead of holding the shell (default 10000). `0` disables
   * promotion, leaving `timeoutMs` as the only bound.
   */
  backgroundAfterMs?: number
  /**
   * Milliseconds a foreground command may run before a call waiting for its
   * shell retires it instead (default 1000). Contention lowers
   * `backgroundAfterMs` to this bar rather than removing it, so a command that
   * finishes inside the bar still serves its own caller. `0` leaves only the
   * threshold.
   */
  contentionAfterMs?: number
}

/** Runtime configuration schema for the persistent Bash tool. */
export const Config: z<Config> = z.object({
  backendType: z.string().default('shell'),
  timeoutMs: z.number().default(300_000),
  maxOutputChars: z.number().default(16_000),
  description: z.string().default(DEFAULT_DESCRIPTION),
  enableRunInBackground: z.boolean().default(true),
  backgroundAfterMs: z.number().min(0).default(10_000),
  contentionAfterMs: z.number().min(0).default(1_000),
})

/** Register one owner-scoped persistent `bash` tool. */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    backendType: config.backendType ?? 'shell',
    timeoutMs: config.timeoutMs ?? 300_000,
    maxOutputChars: config.maxOutputChars ?? 16_000,
    description: config.description ?? DEFAULT_DESCRIPTION,
    enableRunInBackground: config.enableRunInBackground ?? true,
    backgroundAfterMs: config.backgroundAfterMs ?? 10_000,
    contentionAfterMs: config.contentionAfterMs ?? 1_000,
  }
  if (resolved.backendType.trim().length === 0) {
    throw new Error('tool-bash-persistent: backendType must be non-empty')
  }
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs <= 0) {
    throw new Error('tool-bash-persistent: timeoutMs must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxOutputChars) || resolved.maxOutputChars <= 0) {
    throw new Error('tool-bash-persistent: maxOutputChars must be a positive safe integer')
  }
  if (resolved.description.trim().length === 0) {
    throw new Error('tool-bash-persistent: description must be non-empty')
  }
  if (!Number.isSafeInteger(resolved.backgroundAfterMs) || resolved.backgroundAfterMs < 0) {
    throw new Error('tool-bash-persistent: backgroundAfterMs must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(resolved.contentionAfterMs) || resolved.contentionAfterMs < 0) {
    throw new Error('tool-bash-persistent: contentionAfterMs must be a non-negative safe integer')
  }
  registerPersistentBash(ctx, resolved)
}
