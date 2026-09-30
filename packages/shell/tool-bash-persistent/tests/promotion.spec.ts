/**
 * Promotion through the real terminal and job services: a foreground command
 * that outlives the configured threshold is retired into a background job that
 * keeps running, and a refused promotion leaves the command in the foreground
 * on the shell the agent still has.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import TerminalSessionService from '@deepseek-ai/dsh-terminal'
import * as TerminalLocal from '@deepseek-ai/dsh-terminal-bash'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import SandboxProvider from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolBashPersistent from '@deepseek-ai/dsh-tool-bash-persistent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class PassthroughSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

function agent(ctx: Context, cwd: string): Agent {
  const id = SessionId('persistent-bash-promotion-agent')
  const scope = ctx.plugin(() => {})
  const session = Session.create(id, [], {
    version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd, isSeeded: false,
  })
  const value: Agent = {
    id,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const suite = process.platform === 'linux' || process.platform === 'darwin' ? describe : describe.skip

/** Boot one real composition and return its agent-scoped tool driver. */
async function harness(options: { backgroundAfterMs: number; maxJobs: number; contentionAfterMs?: number }) {
  root = await mkdtemp(join(tmpdir(), 'dsh-persistent-promote-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-terminal'",
    "- name: '@deepseek-ai/dsh-test-sandbox'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-sandbox-policy'",
    '  config:',
    '    mode: danger-full-access',
    `    workspaceRoot: ${JSON.stringify(root)}`,
    "- name: '@deepseek-ai/dsh-subprocess-local'",
    "- name: '@deepseek-ai/dsh-terminal-bash'",
    '  config:',
    '    pollIntervalMs: 10',
    '    exactProbeAfterMs: 20',
    '    idleSilenceMs: 30000',
    '    handoffGraceMs: 100',
    '    scrollbackLines: 20000',
    '    timeoutMs: 2000',
    '    disposeGraceMs: 500',
    "- name: '@deepseek-ai/dsh-jobs-local'",
    '  config:',
    `    maxConcurrentJobsPerOwner: ${String(options.maxJobs)}`,
    "- name: '@deepseek-ai/dsh-tool-jobs'",
    "- name: '@deepseek-ai/dsh-tool-bash-persistent'",
    '  config:',
    '    timeoutMs: 20000',
    `    backgroundAfterMs: ${String(options.backgroundAfterMs)}`,
    `    contentionAfterMs: ${String(options.contentionAfterMs ?? 60_000)}`,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-terminal', TerminalSessionService],
    ['@deepseek-ai/dsh-test-sandbox', PassthroughSandbox],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-sandbox-policy', SandboxPolicyService],
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
    ['@deepseek-ai/dsh-terminal-bash', TerminalLocal],
    ['@deepseek-ai/dsh-jobs-local', LocalJobRegistry],
    ['@deepseek-ai/dsh-tool-jobs', ToolJobs],
    ['@deepseek-ai/dsh-tool-bash-persistent', ToolBashPersistent],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()

  const owner = agent(context, root)
  const signal = new AbortController().signal
  const run = (id: string, name: string, args: Record<string, unknown>) => context!.tools.execute({
    signal, callId: ToolCallId(id), name, arguments: args, agent: owner,
  })
  return {
    owner,
    run,
    bash: (id: string, command: string) => run(id, 'bash', { command }),
    // A live shell for the owner is the observable proof that a call is
    // mid-command, which is the state contention has to catch.
    shells: () => context!.terminals.list(owner).length,
  }
}

/** Poll a job's snapshot reads until the accumulated text contains `needle`. */
type Driver = (id: string, name: string, args: Record<string, unknown>) => Promise<{ content: { type: string; text?: string }[] }>

async function collect(run: Driver, needle: string): Promise<string> {
  let seen = ''
  for (let attempt = 0; attempt < 400 && !seen.includes(needle); attempt += 1) {
    seen += text(await run(`read-${attempt}`, 'job_output', { job_id: 'bash-1' }))
    if (!seen.includes(needle)) await new Promise(resolve => setTimeout(resolve, 25))
  }
  return seen
}

suite('persistent Bash promotion', () => {
  it('hands the shell over when a second call is waiting for it', async () => {
    // The threshold is far away, so only contention can retire this command.
    const h = await harness({ backgroundAfterMs: 30_000, maxJobs: 5, contentionAfterMs: 200 })

    const first = h.bash('long', 'sleep 5; printf FIRST_DONE')
    // A loaded worker can take seconds to spawn the PTY, so the wait is bounded
    // by the test's own timeout rather than by a fixed guess at spawn latency.
    for (let attempt = 0; attempt < 2_000 && h.shells() === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(h.shells()).toBeGreaterThan(0)

    const second = await h.bash('next', 'printf SECOND_OK')
    expect(text(await first)).toContain('A newer command needs this shell')
    // The waiting call runs on the shell the promotion handed back.
    expect(text(second)).toContain('SECOND_OK')
    expect(text(second)).toContain('[Command finished with exit code 0]')
  }, 40_000)

  it('keeps a command in the foreground when the contention bar outlasts it', async () => {
    // Contention lowers the bar, it does not remove it: a command that finishes
    // inside the bar still serves its own caller with its own output.
    const h = await harness({ backgroundAfterMs: 30_000, maxJobs: 5, contentionAfterMs: 60_000 })

    const first = h.bash('short', 'sleep 1; printf FIRST_DONE')
    // A loaded worker can take seconds to spawn the PTY, so the wait is bounded
    // by the test's own timeout rather than by a fixed guess at spawn latency.
    for (let attempt = 0; attempt < 2_000 && h.shells() === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(h.shells()).toBeGreaterThan(0)

    const second = await h.bash('next', 'printf SECOND_OK')
    const firstText = text(await first)
    expect(firstText).toContain('FIRST_DONE')
    expect(firstText).not.toContain('moved to the background')
    expect(text(second)).toContain('SECOND_OK')
  }, 40_000)

  it('retires a command that outlives the threshold into a job and replaces the shell', async () => {
    const h = await harness({ backgroundAfterMs: 200, maxJobs: 5 })

    // State the retired shell holds, which the replacement must not carry.
    await h.bash('state', 'export KEEP=promotion-probe')
    expect(text(await h.bash('observe', 'printf "%s" "$KEEP"'))).toContain('promotion-probe')

    // The command must outlive the threshold by a wide margin: the promotion
    // race is decided by a timer, and a loaded worker can delay that timer
    // past a short command, which would make this pass only when run alone.
    const promoted = text(await h.bash('long', 'sleep 3; printf PROMOTED_OK'))
    expect(promoted).toContain('was moved to the background as job bash-1')
    expect(promoted).toContain('next bash call starts from the workspace')

    // The command kept running: the job serves its output after the handoff.
    expect(await collect(h.run, 'PROMOTED_OK')).toContain('PROMOTED_OK')

    // The agent now has a fresh shell, so the retired shell's state is gone.
    const fresh = text(await h.bash('after', 'printf "%s" "${KEEP-unset}"'))
    expect(fresh).toContain('unset')
  }, 40_000)

  it('leaves the command on its own shell when contention cannot register a job', async () => {
    // One job slot, taken for longer than the whole exchange, so the contention
    // promotion must be refused and the queued call simply waits its turn.
    const h = await harness({ backgroundAfterMs: 30_000, maxJobs: 1, contentionAfterMs: 200 })
    await h.run('hold', 'bash', { command: 'sleep 6', run_in_background: true })

    const first = h.bash('long', 'export CONTENDED_REFUSED=kept; sleep 3; printf FIRST_DONE')
    for (let attempt = 0; attempt < 2_000 && h.shells() === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(h.shells()).toBeGreaterThan(0)

    const second = h.bash('next', 'printf "kept=%s" "$CONTENDED_REFUSED"')
    const firstText = text(await first)
    expect(firstText).toContain('FIRST_DONE')
    expect(firstText).not.toContain('moved to the background')
    // The refused promotion left the shell and its state where they were.
    expect(text(await second)).toContain('kept=kept')
  }, 40_000)

  it('keeps the command in the foreground when the registry refuses the job', async () => {
    const h = await harness({ backgroundAfterMs: 200, maxJobs: 1 })

    // Exhaust the owner's one job slot so promotion cannot register.
    expect(text(await h.run('occupy', 'bash', { command: 'sleep 5', run_in_background: true })))
      .toBe('started background job bash-1')

    const result = text(await h.bash('foreground', 'sleep 0.6; printf FOREGROUND_OK'))
    expect(result).toContain('FOREGROUND_OK')
    expect(result).toContain('[Command finished with exit code 0]')
    expect(result).not.toContain('was moved to the background')

    // No second job exists: the refusal did not register anything.
    expect(text(await h.run('list', 'job_list', {}))).not.toContain('bash-2')
  }, 40_000)
})
