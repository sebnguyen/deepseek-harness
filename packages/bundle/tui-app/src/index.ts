/**
 * @deepseek-ai/dsh-tui-app — the interactive terminal application. The bundle
 * patch rides over dsh-base without Host, HTTP, or browser plugins; this
 * runner composes one Agent through the core registry and presents its live
 * session as a React-for-terminals (Ink) interface.
 *
 * Structure: interaction semantics live in {@link TuiController}
 * (`controller.ts`), the component tree in `view.tsx`; this file is only the
 * composition wiring — agent lifecycle, event subscriptions, approvals, and
 * the bounded exit.
 *
 * @module @deepseek-ai/dsh-tui-app
 */

import { randomUUID } from 'node:crypto'

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AgentCancelCause, Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { createElement } from 'react'
import { render } from 'ink'
import { TuiController } from './controller.ts'

import { App } from './view.tsx'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Core services required before the interactive session can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: the resolved startup values this app's provider published. */
export interface Config {
  /** Whether ANSI styling is enabled. */
  color: boolean
  /** The optional seed prompt submitted right after boot. */
  prompt: string
}

export const Config: z<Config> = z.object({
  color: z.boolean().default(true),
  prompt: z.string().default(''),
})

/** Process-facing effects of the runner: streams plus the bounded exit request. */
interface TuiIo {
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The optional approval service's surface, as used by this runner. */
interface TuiApprovalService {
  /** Override one agent's approval policy. */
  setPolicy(agent: Agent, mode: 'ask' | 'never'): void
  /** The active policy label for a session, when overridden. */
  overrideOf(session: Session): string | undefined
}

/** Compose one agent for the terminal session. */
async function composeAgent(ctx: Context, cwd: string, provider: string, model: string): Promise<Agent | undefined> {
  const agents = ctx.get('agents')
  if (agents === undefined) return undefined
  const { agent } = await agents.create({
    sessionId: brandString<SessionId>(`session-${randomUUID()}`),
    meta: { cwd },
    agentOptions: { provider, model },
    setup: (agentCtx) => {
      const selected: ModelSelectionRef = { current: { provider, model }, assembled: undefined }
      installModelSelection(agentCtx, selected)
    },
  })
  await agent.whenIdle()
  return agent
}

/** A subscription pair re-established on `/clear`. */
interface Subscriptions {
  stream: () => void
  events: () => void
}

/** Subscribe the controller to one agent's assistant stream and session log. */
export function tuiSubscribe(ctx: Context, controller: TuiController, agent: Agent): Subscriptions {
  const stream = ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
    if (subject !== agent) return
    controller.ingestFrame(frame)
  })
  const events = ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (session !== agent.session) return
    controller.ingestEvent(event)
  })
  return { stream, events }
}

/** Run the interactive loop until the user asks to leave. */
async function run(ctx: Context, config: Config, io: TuiIo): Promise<void> {
  if (!io.stdin.isTTY) {
    io.stderr.write('dsh: the tui profile needs an interactive terminal (TTY); use `dsh --profile headless "<task>"` for one-shot runs\n')
    io.exit(1)
    return
  }
  // Loader siblings mount concurrently. Await the complete application before
  // composing an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (defaultModel === undefined || sessions === undefined) return

  const selection = defaultModel.currentSelection()
  const cwd = process.cwd()
  const provider = selection.provider
  const model = selection.model

  const composedAgent = await composeAgent(ctx, cwd, provider, model)
  if (composedAgent === undefined || ctx.get('agents') === undefined) {
    io.stderr.write('dsh: the tui profile could not compose its agent\n')
    io.exit(1)
    return
  }
  let agent: Agent = composedAgent

  const color = config.color
  const approvalService = (): TuiApprovalService | undefined => ctx.get('approval')

  let quitting = false
  let subscriptions: Subscriptions = { stream: () => undefined, events: () => undefined }

  /** Graceful exit: settle approvals, flush the log, request the exit. */
  const quit = async (code: number): Promise<void> => {
    if (quitting) return
    quitting = true
    subscriptions.stream()
    subscriptions.events()
    stopApprovals()
    let exitCode = code
    try {
      await sessions.flush(agent.session)
    } catch (error) {
      io.stderr.write(`dsh: session flush failed: ${error instanceof Error ? error.message : String(error)}\n`)
      exitCode = 1
    }
    io.stdout.write(`\nsession ${agent.id} saved — bye\n`)
    io.exit(exitCode)
  }

  /** Compose a replacement agent and move every live subscription to it. */
  const clearSession = async (): Promise<void> => {
    const previous = agent
    const next = await composeAgent(ctx, cwd, provider, model)
    if (next === undefined) {
      controller.note('failed to compose a fresh session')
      return
    }
    subscriptions.stream()
    subscriptions.events()
    agent = next
    subscriptions = tuiSubscribe(ctx, controller, next)
    const flushed = await sessions.flush(previous.session).then(() => true, () => false)
    controller.note(flushed ? `cleared — new session ${next.id}` : `cleared — new session ${next.id} (previous flush failed)`)
  }

  const controller = new TuiController({
    prompt: (text) => { agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })) },
    interrupt: () => { agent.cancel({ kind: 'user' } satisfies AgentCancelCause) },
    clear: () => { void clearSession() },
    quit: () => { void quit(0) },
    facts: () => `${provider}/${model} · ${cwd}`,
    statusLine: busy => `session ${agent.id} · ${busy ? 'working' : 'idle'} · cwd ${cwd}`,
    approvalLabel: () => approvalService()?.overrideOf(agent.session) ?? 'ask (default)',
    setApprovalMode: (mode) => {
      const service = approvalService()
      if (service === undefined) return undefined
      service.setPolicy(agent, mode)
      return mode
    },
  })

  controller.note('terminal profile · /help for commands · ctrl+c interrupts · ctrl+d quits')

  subscriptions = tuiSubscribe(ctx, controller, agent)
  const stopApprovals = ctx.on('approval/request', async (req, next) => {
    if (req.agent !== agent) return next()
    return controller.requestApproval({ toolName: req.toolName, reason: req.reason })
  })

  const app = render(createElement(App, { controller, color, sessionId: agent.id, cwd }), { exitOnCtrlC: false, patchConsole: false })
  controller.onQuit(() => { app.unmount() })

  controller.start()
  if (config.prompt.trim() !== '') controller.submitLine(config.prompt)
}

/** Report an unexpected runner failure and request a failing exit. */
function fail(io: TuiIo, error: unknown): void {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * Mount the terminal application.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated startup values (color choice and optional seed prompt).
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('tui-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: TuiIo = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr, exit }
  void run(ctx, config, io).catch((error: unknown) => { fail(io, error) })
}
