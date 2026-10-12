/**
 * @deepseek-ai/dsh-tui-app — framework-free view-model for the Ink view. The
 * controller owns the transcript entries, the live turn buffer, approvals,
 * slash commands, and the quit handshake, so the React component tree only
 * renders snapshots of this state and forwards keys.
 *
 * @module
 */

import { clearInterval, setInterval } from 'node:timers'

import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { formatUsage, HELP_TEXT, summarizeToolCall, truncateLines } from './render.ts'

/** Approval-waterfall outcomes the controller can hand back. */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** One finished, immutable transcript row (template form drops the row id). */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/** An entry as callers supply it: every shape but the assigned row id. */
export type TuiEntryTemplate = DistributiveOmit<TuiEntry, 'id'>

/** One finished, immutable transcript row. */
export type TuiEntry =
  | { id: number; kind: 'banner'; lines: string[] }
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'reasoning'; text: string }
  | { id: number; kind: 'note'; text: string }
  | { id: number; kind: 'info'; text: string }
  | { id: number; kind: 'error'; text: string }
  | { id: number; kind: 'help'; text: string }
  | { id: number; kind: 'tool-call'; summary: string }
  | { id: number; kind: 'tool-result'; lines: string[]; extra: number; error: string | undefined }
  | { id: number; kind: 'turn'; turn: number; durationSeconds: string; usage: string }
  | { id: number; kind: 'approval'; toolName: string; decision: ApprovalOutcome }

/** Live, streaming state for the active turn (rendered above the status bar). */
export interface TuiWorking {
  /** Epoch ms the turn began. */
  readonly startedAt: number
  /** Latest usage figures reported by the stream. */
  usage: TokenUsage | undefined
  /** Accumulated reasoning-delta text. */
  reasoning: string
  /** Accumulated assistant text. */
  answer: string
}

/** A pending tool-approval question surfaced by the view. */
export interface TuiPendingApproval {
  readonly toolName: string
  readonly reason: string | undefined
  readonly resolve: (outcome: ApprovalOutcome) => void
}

/** Facts the controller cannot produce itself; the wiring supplies them. */
export interface TuiDelegate {
  /** Send a user prompt to the agent (queued by the agent while busy). */
  prompt(text: string): void
  /** Interrupt the currently running turn. */
  interrupt(): void
  /** `/clear`: retire the current session and compose a fresh one. */
  clear(): void
  /** Tear the session tree down and request the bounded exit. */
  quit(): void
  /** Short provider/model/cwd/session string for `/model` and the banner. */
  facts(): string
  /** Descriptive status string for `/status` (session id, cwd, …). */
  statusLine(busy: boolean): string
  /** Current approval policy label, or undefined when no service is composed. */
  approvalLabel(): string | undefined
  /** Apply an approval policy; returns the effective label, if a service exists. */
  setApprovalMode(mode: 'ask' | 'never'): string | undefined
}

/** Spinner glyphs for the status bar. */
export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

/** Idle-period between Ctrl+C strikes before the second strike quits. */
const CTRLC_STRIKE_WINDOW_MS = 1500

/** Join the text blocks of a tool-result message. */
function blocksText(blocks: readonly { readonly type: string; readonly text?: string }[]): string {
  return blocks.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

/**
 * Framework-free TUI state machine. The React view subscribes with
 * {@link TuiController.onChanged} and the plugin listens for the quit
 * handshake on {@link TuiController.onQuit}.
 */
export class TuiController {
  /** Finished transcript rows in display order. */
  readonly entries: TuiEntry[] = []
  /** Live turn state, present while a turn runs. */
  working: TuiWorking | undefined
  /** The question waiting on the user, if any. */
  pendingApproval: TuiPendingApproval | undefined

  private readonly changeListeners = new Set<() => void>()
  private readonly quitListeners = new Set<() => void>()
  private nextId = 1
  private interruptArmAt = 0
  private ticker: NodeJS.Timeout | undefined
  /** Completed turns this session (footer band). */
  turnCount = 0
  /** Cumulative token counters across completed turns (footer band). */
  readonly tokenTotals = { input: 0, output: 0 }

  /**
   * @param delegate - process-facing hooks the plugin wiring provides.
   * @param now - injectable clock for deterministic tests.
   */
  constructor(
    readonly delegate: TuiDelegate,
    private readonly now: () => number = Date.now,
  ) {}

  /** Begin the elapsed-time ticker that keeps the status bar current. */
  start(): void {
    if (this.ticker !== undefined) return
    this.ticker = setInterval(() => {
      if (this.working !== undefined) this.emit()
    }, 250)
    this.ticker.unref()
  }

  /** Stop background timers. */
  dispose(): void {
    if (this.ticker !== undefined) clearInterval(this.ticker)
    this.ticker = undefined
  }

  /** Whether a turn is currently running (activity label in the bands). */
  get busy(): boolean {
    return this.working !== undefined
  }

  /** Subscribe to view-state changes; the return value unsubscribes. */
  onChanged(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }

  /** Subscribe to the quit handshake (the view unmounts on the first fire). */
  onQuit(listener: () => void): () => void {
    this.quitListeners.add(listener)
    return () => { this.quitListeners.delete(listener) }
  }

  private emit(): void {
    for (const listener of this.changeListeners) listener()
  }

  private push(entry: TuiEntryTemplate): void {
    this.entries.push({ ...entry, id: this.nextId++ })
  }

  /** Append any prepared entry (used by the wiring for the boot banner). */
  pushEntry(entry: TuiEntryTemplate): void {
    this.push(entry)
    this.emit()
  }

  /** Append a dim `·` note row. */
  note(text: string): void {
    this.push({ kind: 'note', text })
    this.emit()
  }

  /** Commit streamed turn content to the transcript, keeping the live buffers. */
  private commitStreamed(): void {
    if (this.working === undefined) return
    if (this.working.reasoning.trim() !== '') {
      this.push({ kind: 'reasoning', text: this.working.reasoning.trimEnd() })
    }
    if (this.working.answer !== '') this.push({ kind: 'assistant', text: this.working.answer.trimEnd() })
    this.working.reasoning = ''
    this.working.answer = ''
  }

  /** The status-bar spinner glyph at the current instant. */
  spinGlyph(): string {
    const started = this.working?.startedAt ?? 0
    return SPINNER[Math.floor((this.now() - started) / 80) % SPINNER.length] ?? SPINNER[0]
  }

  /** Whole seconds the active turn has run. */
  elapsedSeconds(): number {
    return this.working === undefined ? 0 : Math.max(0, Math.round((this.now() - this.working.startedAt) / 1000))
  }

  // ———————————————————————— input surface ————————————————————————

  /**
   * Handle one completed input line from the view: slash commands run
   * locally, everything else goes to the agent.
   */
  submitLine(text: string): void {
    const line = text.trim()
    if (line === '') return
    if (line.startsWith('/')) {
      this.runCommand(line)
      return
    }
    this.push({ kind: 'user', text })
    if (this.working !== undefined) {
      const preview = line.length > 48 ? `${line.slice(0, 47)}…` : line
      this.push({ kind: 'note', text: `⏐ queued for the next turn: ${preview}` })
    }
    this.delegate.prompt(text)
    this.emit()
  }

  /** Ctrl+C: interrupt a running turn, otherwise arm a two-strike quit. */
  ctrlC(): void {
    if (this.working !== undefined) {
      this.delegate.interrupt()
      this.note('interrupting the current turn…')
      return
    }
    if (this.now() - this.interruptArmAt < CTRLC_STRIKE_WINDOW_MS) {
      this.requestQuit()
      return
    }
    this.interruptArmAt = this.now()
    this.note('ctrl+c again to quit')
  }

  /** Fire the quit handshake; the delegate performs teardown and exit. */
  requestQuit(): void {
    this.dispose()
    for (const listener of this.quitListeners) listener()
    this.delegate.quit()
  }

  private runCommand(line: string): void {
    const [head = ''] = line.split(/\s+/)
    const argument = line.slice(head.length).trim()
    switch (head) {
      case '/quit':
      case '/exit':
        this.requestQuit()
        return
      case '/help':
        this.push({ kind: 'help', text: HELP_TEXT })
        this.emit()
        return
      case '/model':
        this.push({ kind: 'info', text: this.delegate.facts() })
        this.emit()
        return
      case '/status':
        this.push({ kind: 'info', text: this.delegate.statusLine(this.working !== undefined) })
        this.emit()
        return
      case '/clear':
        this.push({ kind: 'note', text: 'composing a fresh session…' })
        this.emit()
        this.delegate.clear()
        return
      case '/approval':
        if (argument === 'ask' || argument === 'never') {
          this.push({ kind: 'note', text: `approval policy: ${this.delegate.setApprovalMode(argument) ?? argument}` })
        } else {
          const label = this.delegate.approvalLabel()
          this.push(label === undefined
            ? { kind: 'note', text: 'no approval service is composed on this profile' }
            : { kind: 'info', text: `approval policy: ${label} — /approval ask|never to change` })
        }
        this.emit()
        return
      default:
        this.push({ kind: 'error', text: `unknown command ${head} — /help lists commands` })
        this.emit()
    }
  }

  // ———————————————————————— approvals ————————————————————————

  /** Surface a tool approval question; resolves when the user answers. */
  requestApproval(request: { toolName: string; reason?: string | undefined }): Promise<ApprovalOutcome> {
    return new Promise<ApprovalOutcome>((resolve) => {
      this.pendingApproval = {
        toolName: request.toolName,
        reason: request.reason,
        resolve,
      }
      this.emit()
    })
  }

  /** Resolve the pending question (invoked by the view's key handler). */
  approve(outcome: ApprovalOutcome): void {
    const pending = this.pendingApproval
    if (pending === undefined) return
    this.pendingApproval = undefined
    this.push({ kind: 'approval', toolName: pending.toolName, decision: outcome })
    this.emit()
    pending.resolve(outcome)
  }

  /** Settle any outstanding question as rejected (shutdown path). */
  answerApprovals(): void {
    const pending = this.pendingApproval
    if (pending === undefined) return
    this.pendingApproval = undefined
    this.emit()
    pending.resolve('rejected')
  }

  // ———————————————————————— harness feeds ————————————————————————

  /** Ingest one live assistant-stream frame. */
  ingestFrame(frame: AssistantStreamFrame): void {
    if (frame.type === 'start' || frame.type === 'end') return
    const chunk = frame.chunk
    switch (chunk.type) {
      case 'reasoning-delta':
        if (chunk.text === '' || this.working === undefined) return
        this.working.reasoning += chunk.text
        this.emit()
        return
      case 'text-delta':
        if (chunk.text === '' || this.working === undefined) return
        this.working.answer += chunk.text
        this.emit()
        return
      case 'usage':
        if (this.working !== undefined) this.working.usage = chunk.usage
        this.emit()
        return
      case 'block-start':
      case 'block-end':
      case 'tool-call-delta':
      case 'finish':
        return
      /* v8 ignore this -- closed-union exhaustiveness guard */
      default:
        assertNever(chunk, 'tui assistant stream')
    }
  }

  /** Ingest one durable session event. */
  ingestEvent(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start': {
        this.commitStreamed()
        this.working = { startedAt: this.now(), usage: undefined, reasoning: '', answer: '' }
        this.emit()
        return
      }
      case 'turn/end': {
        const reason = event.data.reason
        if (reason.kind === 'error') {
          this.push({ kind: 'error', text: `${reason.error.code}: ${reason.error.message}` })
        } else if (reason.kind !== 'completed') {
          this.push({ kind: 'note', text: `turn ended: ${reason.kind}` })
        }
        const working = this.working
        this.turnCount += 1
        if (working !== undefined) {
          if (working.usage !== undefined) {
            this.tokenTotals.input += working.usage.inputTokens
            this.tokenTotals.output += working.usage.outputTokens
          }
          this.commitStreamed()
          this.push({
            kind: 'turn',
            turn: event.data.turn,
            durationSeconds: ((this.now() - working.startedAt) / 1000).toFixed(1),
            usage: formatUsage(working.usage),
          })
          this.working = undefined
        }
        this.emit()
        return
      }
      case 'tool/call': {
        const summary = summarizeToolCall(event.data.name, event.data.arguments, event.data.purpose)
        this.push({ kind: 'tool-call', summary })
        this.emit()
        return
      }
      case 'tool/result': {
        const text = blocksText(event.data.message.content)
        const preview = truncateLines(text, 4, 100)
        const error = event.data.error as { code?: string } | undefined
        this.push({
          kind: 'tool-result',
          lines: preview.text === '' ? [] : preview.text.split('\n'),
          extra: preview.omitted,
          error: error?.code,
        })
        this.emit()
        return
      }
      default:
        return
    }
  }
}
