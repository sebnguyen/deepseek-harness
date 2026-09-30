/**
 * Background commands through the real terminal and job services: a
 * `run_in_background` call must start its own shell, register a real job, and
 * leave the agent's persistent shell usable with its state intact.
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
import { JobId } from '@deepseek-ai/dsh-jobs'
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
  const id = SessionId('persistent-bash-background-agent')
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

suite('persistent Bash background commands', () => {
  it('registers a job, streams it through job_output and readLines, and leaves the agent shell intact', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-persistent-bg-'))
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
      // Short silence window so a long command's send settles mid-run and
      // its output becomes readable while it is still going.
      '    idleSilenceMs: 200',
      '    handoffGraceMs: 100',
      '    scrollbackLines: 20000',
      '    timeoutMs: 2000',
      '    disposeGraceMs: 500',
      "- name: '@deepseek-ai/dsh-jobs-local'",
      "- name: '@deepseek-ai/dsh-tool-jobs'",
      "- name: '@deepseek-ai/dsh-tool-bash-persistent'",
      '  config:',
      '    timeoutMs: 5000',
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
      signal,
      callId: ToolCallId(id),
      name,
      arguments: args,
      agent: owner,
    })
    const bash = (id: string, command: string, background = false) => run(id, 'bash', {
      command,
      ...background ? { run_in_background: true } : {},
    })

    // The advertised parameter is what makes the path reachable to the model.
    const bashSchema = context.tools.schemas().find(schema => schema.name === 'bash')
    expect(JSON.stringify(bashSchema)).toContain('run_in_background')

    // State the agent's own shell must keep across the background call.
    await bash('state', 'export KEEP=background-probe')

    // The tokens are assembled in the shell so the echoed command line cannot
    // be mistaken for the command's output when lines are read directly.
    // The gap between the lines is what the observation race needs: the tool
    // publishes the first line only once its send settles on the idle window,
    // so a gap that a loaded machine can swallow would let the second line
    // arrive first and make the cursor assertions meaningless.
    const started = text(await bash('bg', 'printf "line-%s\\n" one; sleep 3; printf "line-%s\\n" two', true))
    expect(started).toBe('started background job bash-1')

    const listed = text(await run('list', 'job_list', {}))
    expect(listed).toContain('bash-1 [bash]')

    // An observer follows the same output by absolute line index while the
    // command is still running. This must not take the bytes the model's own
    // read still owes, so the job_output read below is the proof it did not.
    const jobId = JobId('bash-1')
    let first = ''
    for (let attempt = 0; attempt < 400 && !first.includes('line-one'); attempt += 1) {
      first = (context.jobs.readLines(jobId, owner)?.lines ?? []).join('\n')
      if (!first.includes('line-one')) await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(first).toContain('line-one')
    expect(first).not.toContain('line-two')
    const cursor = context.jobs.readLines(jobId, owner)?.next ?? 0

    // Settle first, then read: output must survive the session release that
    // settlement performs, which is the order a caller uses after a notice.
    let settled = ''
    for (let attempt = 0; attempt < 400 && !settled.includes('completed'); attempt += 1) {
      settled = text(await run(`list-${attempt}`, 'job_list', {}))
      if (!settled.includes('completed')) await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(settled).toContain('completed')

    // The cursor taken before the second line arrived reads only what followed it.
    const later = (context.jobs.readLines(jobId, owner, cursor)?.lines ?? []).join('\n')
    expect(later).toContain('line-two')
    expect(later).not.toContain('line-one')

    const collected = text(await run('read', 'job_output', { job_id: 'bash-1', timeout_ms: 50 }))
    expect(collected).toContain('line-one')
    expect(collected).toContain('line-two')

    // The background command ran in its own shell: this one still holds state
    // and answers immediately instead of queueing behind it.
    const observed = text(await bash('observe', 'printf "%s\\n" "$KEEP"'))
    expect(observed).toContain('background-probe')
  }, 40_000)
})
