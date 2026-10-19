import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellProcessRead, ShellRunResult } from '@deepseek-ai/dsh-shell'
import SystemPrompt, { BUILT_IN_CORE_GUIDANCE_SECTION_NAMES } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { PURPOSE_KEY, TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as ToolTasks from '@deepseek-ai/dsh-tool-jobs'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as ToolBashFrames from '@deepseek-ai/dsh-tool-bash-frames'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import { processOutcome } from '../src/background.ts'
import { renderProcessRead, renderResult } from '@deepseek-ai/dsh-shell'

const testToolSignal = new AbortController().signal

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-tool-bash-spec-'))

afterAll(() => {
  rmSync(spillDir, { recursive: true, force: true })
})

/** Foreground-only harness: no job runtime (backgrounding fails loud here). */
async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalSubprocessRuntime)
  ; (ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, graceMs: 200 })
  await ctx.plugin(ToolBashFrames)
  return ctx
}

/** Full harness: the generic job runtime + its controller, then the bash tool. */
async function setupWithTasks() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalJobRegistry)
  await ctx.plugin(ToolTasks)
  await ctx.plugin(LocalSubprocessRuntime)
  ; (ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, graceMs: 200 })
  await ctx.plugin(ToolBashFrames)
  return ctx
}

/**
 * Build a fake {@link Agent} with the shared agent/session identity, give it a
 * dedicated lifecycle fiber for `Agent.ctx`, and register it in `ctx.agents`.
 */
function registerFakeAgent(ctx: Context, sessionId: string, inject: (...args: unknown[]) => void = () => { }): Agent {
  const scopeFiber = ctx.plugin(() => { })
  const id = SessionId(sessionId)
  const agent = {
    id,
    ctx: scopeFiber.ctx,
    inject,
    session: { id, header: { version: 0, id, createdAt: 0 } },
  } as unknown as Agent
  ctx.agents.register(agent)
  return agent
}
let callCounter = 0
function call(ctx: Context, name: string, args: unknown, agent?: Agent) {
  return ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId(`call-${++callCounter}`), name, arguments: { description: 'tool-bash-frames tools.spec coverage', ...(args as Record<string, unknown>) }, ...agent ? { agent } : {} })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

async function callUntilText(
  ctx: Context,
  name: string,
  args: unknown,
  expected: string,
  timeoutMs = 5_000,
): Promise<Awaited<ReturnType<typeof call>>> {
  const deadline = Date.now() + timeoutMs
  let last: Awaited<ReturnType<typeof call>> | undefined
  while (Date.now() < deadline) {
    last = await call(ctx, name, args)
    if (text(last).includes(expected)) return last
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`${name} output did not include ${JSON.stringify(expected)}; last text was ${JSON.stringify(last !== undefined ? text(last) : '')}`)
}

class RecordingSandboxExecutor extends ShellExecutor {
  readonly modes: Array<string | undefined> = []

  override get sandboxMode() {
    return 'read-only' as const
  }

  resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      timeoutMs: request.timeoutMs ?? 1000,
      ...request.signal ? { signal: request.signal } : {},
      sandboxPolicy: request.sandboxPolicy ?? { mode: 'read-only', workspaceRoot: process.cwd() },
    }
  }

  run(spec: ShellExecSpec): Promise<ShellRunResult> {
    this.modes.push(spec.sandboxPolicy?.mode)
    return Promise.resolve({
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: 'ok', truncated: false },
      stderr: { text: '', truncated: false },
      sandbox: {
        mode: spec.sandboxPolicy?.mode ?? 'read-only',
        denied: false,
        ...spec.command === 'without optional sandbox facts'
          ? {}
          : { enforcement: 'full' as const, runnerFailed: false },
      },
    })
  }

  start(spec: ShellExecSpec): ShellProcess {
    this.modes.push(spec.sandboxPolicy?.mode)
    return {
      status: 'completed',
      exitCode: 0,
      signal: null,
      done: Promise.resolve(),
      sandbox: { mode: spec.sandboxPolicy?.mode ?? 'read-only', denied: false },
      readOutput: () => ({ delta: '', lossy: false }),
      kill: () => false,
    }
  }
}

/** Test executor that records whether the background start boundary was crossed. */
class CountingStartExecutor extends ShellExecutor {
  starts = 0

  resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? '/x',
      timeoutMs: request.timeoutMs ?? 0,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  run(): Promise<ShellRunResult> { return Promise.reject(new Error('unused')) }

  start(): ShellProcess {
    this.starts += 1
    return {
      status: 'completed',
      exitCode: 0,
      signal: null,
      done: Promise.resolve(),
      readOutput: () => ({ delta: '', lossy: false }),
      kill: () => false,
    }
  }
}

async function setupSandboxed() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalJobRegistry)
  await ctx.plugin(ToolTasks)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
  await ctx.plugin(SandboxPolicyService, {})
  await ctx.plugin(RecordingSandboxExecutor)
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(ToolBashFrames)
  return { ctx, bash: ctx.shell as RecordingSandboxExecutor }
}

describe('bash tool', () => {
  it('returns stdout for a successful element', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'multi_bash', { commands: [{ command: 'echo hello' }] })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected bash success')
    expect(result.value).toMatchObject({
      kind: 'frames',
      frames: [{
        index: 0,
        command: 'echo hello',
        outcome: {
          kind: 'foreground',
          exitCode: 0,
          signal: null,
          timedOut: false,
          aborted: false,
          stdout: { text: 'hello\n', truncated: false },
          stderr: { text: '', truncated: false },
        },
      }],
    })
    expect(text(result)).toBe('[1/1] $ echo hello\nhello\n')
  })

  it('reports (no output) for silent commands', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'multi_bash', { commands: [{ command: 'true' }] })
    expect(text(result)).toBe('[1/1] $ true\n(no output)')
  })

  it('marks stderr sections', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'multi_bash', { commands: [{ command: 'echo out; echo err >&2' }] })
    expect(text(result)).toBe('[1/1] $ echo out; echo err >&2\nout\n[stderr]\nerr\n')
    expect(result.isError).toBe(false)
  })

  it('reports non-zero exits without isError', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'multi_bash', { commands: [{ command: 'echo failing; exit 3' }] })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('[1/1] $ echo failing; exit 3\nfailing\n[exit code: 3]')
  })

  it('reports timeout kills with both markers (timeout first)', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'multi_bash', { commands: [{ command: 'sleep 60', timeoutMs: 100 }] })
    expect(result.isError).toBe(false)
    expect(text(result)).toBe('[1/1] $ sleep 60\n(no output)\n[timed out after 100ms]\n[killed by signal: SIGTERM]')
  })

  it('reports a timeout even when the command traps the signal and exits 0', async () => {
    // The signal-independent timeout marker: a trapped SIGTERM that exits 0
    // after our timer fired must NOT look like a clean success. (bash may
    // print "Terminated" to stderr for the killed sleep — environment
    // dependent — so assert the marker, not the exact body.)
    const ctx = await setup()
    const result = await call(ctx, 'multi_bash', { commands: [{ command: 'trap "exit 0" TERM; sleep 60', timeoutMs: 100 }] })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('[timed out after 100ms]')
    expect(text(result)).not.toContain('[exit code:')
  })

  it('reports truncation with the spill path', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    ; (ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
    await ctx.plugin(LocalBashExecutor, { maxOutputBytes: 100, graceMs: 200 })
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(ToolBashFrames)
    const result = await call(ctx, 'multi_bash', { commands: [{ command: 'for i in $(seq 1 100); do printf "line-%04d\\n" $i; done' }] })
    expect(text(result)).toContain('[output truncated; full output: ')
    expect(text(result)).toContain('line-0100')
  })

  it('honors an element workdir override', async () => {
    const ctx = await setup()
    const element = await call(ctx, 'multi_bash', { commands: [{ command: 'pwd', workdir: '/tmp' }] })
    expect(text(element).trim()).toMatch(/\/tmp$/)
  })

  it('surfaces spawn failures as isError', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'multi_bash', { commands: [{ command: 'true', workdir: '/nonexistent-dsh' }] })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/ENOENT/)
  })

  it('surfaces foreground aborts as the structured TOOL_ABORTED error', async () => {
    const ctx = await setup()
    const controller = new AbortController()
    const pending = ctx.tools.execute({
      callId: ToolCallId('call-abort'),
      name: 'multi_bash',
      arguments: { commands: [{ command: 'sleep 60' }], description: 'abort a sleeping foreground batch' },
      signal: controller.signal,
    })
    setTimeout(() => { controller.abort() }, 50)
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({
      message: 'tool call aborted',
      info: { name: 'AbortError', code: TOOL_ABORTED },
    })
  })

  // Type and required-key violations are rejected by the harness
  // (defineTool validates against the ParameterSchemaSpec — the arg-validation Agent Note) before execute.
  it.each([
    [{}, /missing required property "commands"/],
    [{ commands: 'ls' }, /"commands" must be an array/],
    [{ commands: [{}] }, /missing required property "commands\[0\]\.command"/],
    [{ commands: [{ command: 'x', run_in_background: 'yes' }] }, /"commands\[0\]\.run_in_background" must be a boolean/],
  ])('rejects schema-invalid args %j', async (args, pattern) => {
    const ctx = await setup()
    const result = await call(ctx, 'multi_bash', args)
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(pattern)
  })

  // Value constraints the ParameterSchemaSpec can't express stay in the tool body.
  it.each([
    [{ commands: [{ command: '  ' }] }, /invalid commands element/],
    [{ commands: [{ command: 'x', timeoutMs: -1 }] }, /invalid commands element timeoutMs/],
    [{ commands: [] }, /invalid commands: expected a non-empty array/],
  ])('rejects value-invalid args %j', async (args, pattern) => {
    const ctx = await setup()
    const result = await call(ctx, 'multi_bash', args)
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(pattern)
  })

  it('rejects a non-JSON numeric argument before tool-specific validation', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'multi_bash', {
      commands: [{ command: 'x', timeoutMs: Number.NaN }],
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('tool execution arguments must be losslessly JSON-serializable')
  })

  it('registers the commands-only schema with element run_in_background exposed by default', async () => {
    const ctx = await setup()
    const schemas = ctx.tools.schemas()
    expect(schemas.map(schema => schema.name)).toEqual(['multi_bash'])
    const bashSchema = schemas[0]!
    expect(bashSchema.parameters).toMatchObject({
      type: 'object',
      required: ['commands', PURPOSE_KEY],
    })
    const properties = bashSchema.parameters.properties as Record<string, { items?: { properties?: Record<string, unknown> } }>
    expect(Object.keys(properties)).toEqual(['commands', PURPOSE_KEY])
    expect(Object.keys(properties['commands']?.items?.properties as Record<string, unknown>))
      .toContain('run_in_background')
    expect(bashSchema.description).toContain('job_output')
  })

  it('contributes the exit-code habit as its prompt section (guidance the descriptions cannot carry)', async () => {
    const ctx = await setup()
    ctx.systemPrompt.section({
      name: 'test:before-bash',
      order: ctx.systemPrompt.getSectionOrder('TOOL_BASH') - 10,
      text: 'before',
    })
    ctx.systemPrompt.section({
      name: 'test:after-bash',
      order: ctx.systemPrompt.getSectionOrder('TOOL_BASH') + 10,
      text: 'after',
    })
    const assembly = await ctx.systemPrompt.assemble()
    const section = assembly.sections.find(s => s.name === 'tool:multi_bash')
    expect(assembly.sections.map(s => s.name)).toEqual([
      'deployment:persona-prefix',
      ...BUILT_IN_CORE_GUIDANCE_SECTION_NAMES,
      'test:before-bash',
      'tool:multi_bash',
      'test:after-bash',
      'deployment:persona-suffix',
    ])
    expect(section?.text).toContain('[exit code: N]')
  })

  it('unregisters everything when the plugin fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalBashExecutor, {})
    await ctx.plugin(BashEnvPlugin)
    const fiber = await ctx.plugin(ToolBashFrames)
    expect(ctx.tools.schemas()).toHaveLength(1)
    expect((await ctx.systemPrompt.assemble()).sections.map(s => s.name)).toEqual([
      'deployment:persona-prefix',
      ...BUILT_IN_CORE_GUIDANCE_SECTION_NAMES,
      'tool:multi_bash',
      'deployment:persona-suffix',
    ])
    await fiber.dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
    // Only the system-prompt plugin's own built-in sections remain.
    expect((await ctx.systemPrompt.assemble()).sections.map(s => s.name)).toEqual([
      'deployment:persona-prefix',
      ...BUILT_IN_CORE_GUIDANCE_SECTION_NAMES,
      'deployment:persona-suffix',
    ])
  })

  it('tools depend on the executor: no registration without ctx.shell', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    // inject: ['tools', 'bash'] keeps the plugin pending until bash exists.
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(ToolBashFrames)
    expect(ctx.tools.schemas()).toHaveLength(0)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalBashExecutor, {})
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctx.tools.schemas()).toHaveLength(1)
  })

  it('applies the built-in background default when apply() receives a bare config', async () => {
    // Bypasses the schemastery defaults on purpose: apply() must stand on its
    // own `?? true` fallback when embedded programmatically without the schema.
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalBashExecutor, {})
    ToolBashFrames.apply(ctx, {})
    const schema = ctx.tools.schemas()[0]!
    const items = (schema.parameters.properties as { commands: { items: { properties: Record<string, unknown> } } }).commands.items
    expect(Object.keys(items.properties))
      .toContain('run_in_background')
  })
})

describe('background execution through the job runtime', () => {
  it('a background element acks with the job id inside its frame, readable through the REAL job_output tool', async () => {
    const ctx = await setupWithTasks()
    const started = await call(ctx, 'multi_bash', { commands: [{ command: 'echo bg-ok', run_in_background: true }] })
    expect(started.isError).toBe(false)
    if (started.isError) throw new Error('expected background bash success')
    expect(started.value).toMatchObject({ kind: 'frames', frames: [{ outcome: { kind: 'job', jobId: 'bash-1' } }] })
    expect(text(started)).toBe('[1/1] $ echo bg-ok\nstarted background job bash-1')

    const read = await callUntilText(ctx, 'job_output', { job_id: 'bash-1' }, 'bg-ok')
    expect(text(read)).toContain('bg-ok')
    // A later read reports the terminal outcome in the generic status line.
    const final = await callUntilText(ctx, 'job_output', { job_id: 'bash-1' }, '[status: completed, exit code: 0]')
    expect(final.isError).toBe(false)
  })

  it('a running background job is killable through the REAL job_kill tool', async () => {
    const ctx = await setupWithTasks()
    await call(ctx, 'multi_bash', { commands: [{ command: 'sleep 60', run_in_background: true }] })

    const killed = await call(ctx, 'job_kill', { job_id: 'bash-1' })
    expect(text(killed)).toBe('requested cancellation of job bash-1')
    // The cancel reached the process handle; the task settles as killed with
    // the signal detail mapped by processOutcome.
    const final = await call(ctx, 'job_output', { job_id: 'bash-1' })
    expect(text(final)).toContain('[status: killed, signal: SIGTERM]')
  })

  it('a self-signal background exit is reported as killed through the REAL job_output tool', async () => {
    const ctx = await setupWithTasks()
    await call(ctx, 'multi_bash', { commands: [{ command: 'kill -TERM $$', run_in_background: true }] })

    const final = await call(ctx, 'job_output', { job_id: 'bash-1' })
    expect(text(final)).toContain('[status: killed, signal: SIGTERM]')
  })

  it('a background job started by an agent is registered with that agent as owner', async () => {
    // The producer must forward exec.agent as the job owner.
    const ctx = await setupWithTasks()
    const agent = registerFakeAgent(ctx, 'sess-owner')
    const started = await call(ctx, 'multi_bash', { commands: [{ command: 'sleep 60', run_in_background: true }] }, agent)
    expect(text(started)).toContain('started background job bash-1')

    const anon = await call(ctx, 'job_output', { job_id: 'bash-1' })
    expect(anon.isError).toBe(true)
    expect(text(anon)).toMatch(/belongs to another session/)

    const killed = await call(ctx, 'job_kill', { job_id: 'bash-1' }, agent)
    expect(killed.isError).toBe(false)
    await call(ctx, 'job_output', { job_id: 'bash-1' }, agent) // await settlement — no orphan
  })

  it('fails loud when the job runtime is not loaded', async () => {
    const ctx = await setup() // no LocalJobRegistry / ToolTasks
    const result = await call(ctx, 'multi_bash', { commands: [{ command: 'sleep 60', run_in_background: true }] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
  })

  it('a pre-aborted call is skipped before the process starts', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    await ctx.plugin(ToolTasks)
    await ctx.plugin(CountingStartExecutor)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(ToolBashFrames)

    const controller = new AbortController()
    controller.abort()
    const result = await ctx.tools.execute({
      callId: ToolCallId('call-pre-aborted'),
      name: 'multi_bash',
      arguments: { commands: [{ command: 'sleep 60', run_in_background: true }], description: 'a pre-aborted batch is skipped before the process starts' },
      signal: controller.signal,
    })
    expect(result.isError).toBe(true)
    expect(result.error).toEqual({
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    })
    expect(text(result)).toBe('Error: tool call aborted before dispatch')
    expect((ctx.shell as CountingStartExecutor).starts).toBe(0)
  })

  it('never spawns the process when tasks.start preflight throws (no orphan, by construction)', async () => {
    // With no job controller, preflight fails before the executor can spawn.
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    await ctx.plugin(CountingStartExecutor)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(ToolBashFrames)

    const result = await call(ctx, 'multi_bash', { commands: [{ command: 'sleep 60', run_in_background: true }] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('no job controller serves this agent')
    // Declare-then-execute: the failed preflight means no process ever ran.
    expect((ctx.shell as CountingStartExecutor).starts).toBe(0)
  })

  it('enableRunInBackground: false removes the element parameter and flips the description', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(LocalBashExecutor, {})
    await ctx.plugin(ToolBashFrames, { enableRunInBackground: false })

    const schema = ctx.tools.schemas().find(s => s.name === 'multi_bash')!
    expect(Object.keys(schema.parameters.properties as Record<string, unknown>))
      .toEqual(['commands', PURPOSE_KEY])
    const items = (schema.parameters.properties as { commands: { items: { properties: Record<string, unknown> } } }).commands.items
    expect(items.properties).not.toHaveProperty('run_in_background')
    expect(schema.description).toContain('Background execution is not available')
    expect(schema.description).not.toContain('run_in_background: true')
    // The registry-held definition agrees (schema and capability never disagree).
    const parameters = ctx.tools.get('multi_bash')!.parameters as { properties: { commands: { items: { properties: Record<string, unknown> } } } }
    expect('run_in_background' in parameters.properties.commands.items.properties).toBe(false)

    // Schema omission is advertising; execution must also enforce the opt-out.
    const forced = await call(ctx, 'multi_bash', { commands: [{ command: 'echo hi', run_in_background: true }] })
    expect(forced.isError).toBe(true)
    expect(text(forced)).toContain('run_in_background is disabled for this deployment')
    const foreground = await call(ctx, 'multi_bash', { commands: [{ command: 'echo hi' }] })
    expect(foreground.isError).toBe(false)
  })
})

describe('sandbox confinement plumbing', () => {
  it('fails load when a confining executor has no shared sandbox-policy resolver', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(RecordingSandboxExecutor)
    await ctx.plugin(BashEnvPlugin)
    await expect(ctx.plugin(ToolBashFrames)).rejects.toThrow('tool-bash-frames: the mounted bash executor confines but ctx.sandboxPolicy is missing')
  })

  it('omits sandbox facts the executor did not acquire from the canonical result', async () => {
    const { ctx } = await setupSandboxed()
    const result = await call(ctx, 'multi_bash', {
      commands: [{ command: 'without optional sandbox facts' }],
    })

    if (result.isError) throw new Error('expected foreground bash success')
    const outcome = (result.value as { frames: { outcome: { sandbox?: Record<string, unknown> } }[] }).frames[0]!.outcome
    expect(outcome).toMatchObject({ sandbox: { mode: 'read-only', denied: false } })
    expect(outcome.sandbox).not.toHaveProperty('enforcement')
    expect(outcome.sandbox).not.toHaveProperty('runnerFailed')
  })
})

describe('renderProcessRead', () => {
  const base: ShellProcessRead = { delta: 'out\n', lossy: false }

  it('returns the delta verbatim for a lossless read', () => {
    expect(renderProcessRead(base)).toBe('out\n')
    expect(renderProcessRead({ delta: '', lossy: false })).toBe('')
  })

  it('appends the loss notice with the available spill paths', () => {
    expect(renderProcessRead({ ...base, lossy: true, stdoutSpillPath: '/spill/out.log' }))
      .toBe('out\n[some output was dropped from memory; full output: /spill/out.log]')
    expect(renderProcessRead({ ...base, lossy: true, stdoutSpillPath: '/spill/out.log', stderrSpillPath: '/spill/err.log' }))
      .toBe('out\n[some output was dropped from memory; full output: /spill/out.log, /spill/err.log]')
  })

  it('reports (unavailable) when a lossy read has no safe spill path', () => {
    expect(renderProcessRead({ ...base, lossy: true }))
      .toBe('out\n[some output was dropped from memory; full output: (unavailable)]')
  })

  it('an empty lossy delta is the notice alone', () => {
    expect(renderProcessRead({ delta: '', lossy: true, stderrSpillPath: '/spill/err.log' }))
      .toBe('[some output was dropped from memory; full output: /spill/err.log]')
  })

  it('inserts the separating newline only when the delta lacks one', () => {
    expect(renderProcessRead({ delta: 'tail', lossy: true }))
      .toBe('tail\n[some output was dropped from memory; full output: (unavailable)]')
    expect(renderProcessRead({ delta: 'tail\n', lossy: true }))
      .toBe('tail\n[some output was dropped from memory; full output: (unavailable)]')
  })

  it('appends settled sandbox denial and runner-failure facts', () => {
    expect(renderProcessRead(base, { mode: 'read-only', denied: true }, ['workspace-write']))
      .toContain('[sandbox: escalation available')
    expect(renderProcessRead({ delta: 'tail', lossy: false }, { mode: 'read-only', denied: true }))
      .toBe('tail\n[sandbox: file access denied under read-only mode]')
    const runner = renderProcessRead(
      { delta: '', lossy: false },
      { mode: 'workspace-write', denied: true, runnerFailed: true },
      ['danger-full-access'],
    )
    expect(runner).toContain('sandbox runner itself failed under workspace-write mode')
    expect(runner).not.toContain('file access denied')
  })
})

describe('processOutcome', () => {
  function settled(over: Partial<ShellProcess>): ShellProcess {
    return {
      status: 'completed',
      exitCode: 0,
      signal: null,
      done: Promise.resolve(),
      readOutput: () => ({ delta: '', lossy: false }),
      kill: () => false,
      ...over,
    }
  }

  it('maps a signal-killed process to killed with the signal detail', () => {
    expect(processOutcome(settled({ status: 'killed', signal: 'SIGTERM' })))
      .toEqual({ status: 'killed', detail: 'signal: SIGTERM' })
  })

  it('maps a killed process without a recorded signal (kill raced exit / spawn failure)', () => {
    expect(processOutcome(settled({ status: 'killed', exitCode: null })))
      .toEqual({ status: 'killed', detail: 'killed before exit' })
  })

  it('maps a completed process to its exit code', () => {
    expect(processOutcome(settled({ exitCode: 3 })))
      .toEqual({ status: 'completed', detail: 'exit code: 3' })
  })

  it('defensively reads a null exit code as 0 (handle shapes from other executors)', () => {
    expect(processOutcome(settled({ exitCode: null })))
      .toEqual({ status: 'completed', detail: 'exit code: 0' })
  })
})

describe('session-cwd routing (per-session workdir)', () => {
  // An agent whose session header carries a cwd (what session/new records).
  const agentInCwd = (cwd: string) =>
    ({ inject: () => undefined, session: { header: { version: 0, id: 'c', createdAt: 0, cwd } } }) as unknown as Agent

  it('defaults bash to the agent\'s session cwd (not the server launch dir)', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'multi_bash', { commands: [{ command: 'pwd' }] }, agentInCwd('/tmp'))
    expect(text(result).trim()).toMatch(/\/tmp$/)
  })

  it('an explicit absolute workdir overrides the session cwd', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'multi_bash', { commands: [{ command: 'pwd', workdir: '/tmp' }] }, agentInCwd('/'))
    expect(text(result).trim()).toMatch(/\/tmp$/)
  })

  it('a relative workdir is resolved against the session cwd', async () => {
    const ctx = await setup()
    // session cwd /usr + relative 'bin' → /usr/bin
    const result = await call(ctx, 'multi_bash', { commands: [{ command: 'pwd', workdir: 'bin' }] }, agentInCwd('/usr'))
    expect(text(result).trim()).toMatch(/\/usr\/bin$/)
  })

  it('two sessions with different cwds each run bash in their own dir', async () => {
    const ctx = await setup()
    const inUsr = await call(ctx, 'multi_bash', { commands: [{ command: 'pwd' }] }, agentInCwd('/usr'))
    const inTmp = await call(ctx, 'multi_bash', { commands: [{ command: 'pwd' }] }, agentInCwd('/tmp'))
    expect(text(inUsr).trim()).toMatch(/\/usr$/)
    expect(text(inTmp).trim()).toMatch(/\/tmp$/)
  })

  it('falls back to the executor default when the agent has no session cwd', async () => {
    const ctx = await setup()
    // No exec.agent at all → executor uses its config/process.cwd() default.
    const result = await ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('cwd-noagent'), name: 'multi_bash', arguments: { commands: [{ command: 'pwd' }], description: 'no-agent batch falls back to the executor cwd' } })
    expect(result.isError).toBe(false)
    expect(text(result).trim().length).toBeGreaterThan(0)
  })
})

describe('renderResult', () => {
  const base = {
    exitCode: 0 as number | null,
    signal: null as NodeJS.Signals | null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1000,
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
  }

  it('renders stderr-only output without a stdout prefix', () => {
    expect(renderResult({ ...base, stderr: { text: 'err\n', truncated: false } }))
      .toBe('[stderr]\nerr\n')
  })

  it('adds a separator when stdout does not end with a newline', () => {
    expect(renderResult({
      ...base,
      stdout: { text: 'out', truncated: false },
      stderr: { text: 'err', truncated: false },
    })).toBe('out\n[stderr]\nerr')
  })

  it('appends exit-code markers after a newline for unterminated output', () => {
    expect(renderResult({ ...base, exitCode: 7, stdout: { text: 'x', truncated: false } }))
      .toBe('x\n[exit code: 7]')
  })

  it('renders signal kills without the timeout marker when not timed out', () => {
    expect(renderResult({ ...base, exitCode: null, signal: 'SIGKILL' }))
      .toBe('(no output)\n[killed by signal: SIGKILL]')
  })

  it('reports a timeout that exited 0 (trapped signal) without a kill marker', () => {
    expect(renderResult({ ...base, exitCode: 0, signal: null, timedOut: true }))
      .toBe('(no output)\n[timed out after 1000ms]')
  })

  it('orders the timeout marker before a kill marker', () => {
    expect(renderResult({ ...base, exitCode: null, signal: 'SIGTERM', timedOut: true }))
      .toBe('(no output)\n[timed out after 1000ms]\n[killed by signal: SIGTERM]')
  })

  it('notes truncation with a fallback when the spill path is missing', () => {
    expect(renderResult({ ...base, stdout: { text: 'tail', truncated: true } }))
      .toBe('tail\n[output truncated; full output: (unavailable)]')
  })

  it('reports sandbox denials before exit status and hints only when escalation is advertised', () => {
    const result: ShellRunResult = {
      exitCode: 1,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: 1000,
      stdout: { text: '', truncated: false },
      stderr: { text: 'denied', truncated: false },
      sandbox: { mode: 'read-only', denied: true },
    }
    expect(renderResult(result)).toMatch(/denied under read-only mode\]\n\[exit code: 1\]$/)
    expect(renderResult(result, ['workspace-write'])).toContain('[sandbox: escalation available')
    expect(renderResult({ ...result, sandbox: { mode: 'read-only', denied: false } }, ['workspace-write']))
      .not.toContain('[sandbox:')
  })
})

describe('tool-owned UI presentation (presentCall / presentResult)', () => {
  it('bash presentCall: a pending batch is a generic execute card listing every command', async () => {
    const ctx = await setup()
    expect(ctx.tools.get('multi_bash')?.presentCall?.({
      commands: [{ command: 'ls -la src' }, { command: 'pwd' }],
    }))
      .toEqual({
        card: 'generic',
        title: '2 commands: ls -la src',
        kind: 'execute',
        rawInput: JSON.stringify([{ command: 'ls -la src' }, { command: 'pwd' }]),
        content: [{ type: 'text', text: '$ ls -la src\n$ pwd' }],
      })
  })

  it('bash presentResult: settled output is fenced console text without an exit pill', async () => {
    const ctx = await setup()
    const present = ctx.tools.get('multi_bash')!.presentResult!(
      { commands: [{ command: 'x' }] },
      { content: [{ type: 'text', text: '[1/1] $ x\noops\n[exit code: 3]' }], isError: false },
    )
    expect(present).toEqual({ card: 'generic', content: [{ type: 'text', text: '```console\n[1/1] $ x\noops\n[exit code: 3]\n```' }] })
  })

  it('bash presentResult: trailing blank lines are trimmed inside the fence', async () => {
    const ctx = await setup()
    const present = ctx.tools.get('multi_bash')!.presentResult!(
      { commands: [{ command: 'printf "hi\\n\\n"' }] },
      // A clean run renders no exit marker, so the body is the raw bytes.
      { content: [{ type: 'text', text: 'hi\n\n' }], isError: false },
    )
    expect(present).toEqual({ card: 'generic', content: [{ type: 'text', text: '```console\nhi\n```' }] })
  })

  it('bash presentResult: an isError result is a generic card (no real process exit to report)', async () => {
    const ctx = await setup()
    // A spawn failure / abort has no process exit — the body is an error message,
    // not renderResult output, so a generic fenced card, no terminal output/exit.
    const out = ctx.tools.get('multi_bash')!.presentResult!(
      { commands: [{ command: 'x' }] },
      { content: [{ type: 'text', text: 'tool call aborted' }], isError: true },
    )
    expect(out).toEqual({ card: 'generic', content: [{ type: 'text', text: '```console\ntool call aborted\n```' }] })
  })

  it('bash presentResult: leaves a non-text (unexpected) result untouched → undefined (UI keeps raw content)', async () => {
    const ctx = await setup()
    const present = ctx.tools.get('multi_bash')!.presentResult!(
      { commands: [{ command: 'x' }] },
      { content: [{ type: 'reasoning', text: 'unexpected' }], isError: false },
    )
    expect(present).toBeUndefined()
  })

  it('bash presentResult: a result that is not exactly one block → undefined (no single text to fence)', async () => {
    const ctx = await setup()
    const args = { commands: [{ command: 'x' }] }
    // Empty content (no block) and multi-block content both fall through.
    expect(ctx.tools.get('multi_bash')!.presentResult!(args, { content: [], isError: false })).toBeUndefined()
    expect(ctx.tools.get('multi_bash')!.presentResult!(args, {
      content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
      isError: false,
    })).toBeUndefined()
  })

  it('presentCall validates softly: args without the required batch return undefined, never throw', async () => {
    const ctx = await setup()
    // `defineTool` soft-validates replayed logged args before presentation. Invalid shapes return
    // undefined for generic UI rendering rather than throwing; `presentCall` accepts `unknown`.
    expect(ctx.tools.get('multi_bash')?.presentCall?.({ command: 'ls' })).toBeUndefined()
  })
})

describe('the model-facing bash tool builds its request from named args only (no {...args} forward)', () => {
  const recordingDshHome = join(spillDir, 'dsh-home')

  /**
   * Records every {@link ShellExecRequest} the consumer hands to `resolve()`, so a
   * test can assert what the model-facing tool DID and DID NOT forward. The `bash`
   * tool does not expose trusted-plugin fields (`stdoutMaxBytes`, `stdin`, or
   * `env`) as parameters, so it must build its request from named args only and
   * never spread unknown tool-call keys into it. This guard's job is to catch a
   * future refactor that blindly forwards `...args` — which would silently thread
   * model input into the post-scrub `env` merge or per-run capture budget — NOT
   * to defend a trust boundary
   * (the credential scrub in dsh-bash-local is the security control; see the
   * bash-stdin-env Agent Note). Foreground `run()` returns a canned result; `start()`
   * hands back an already-settled fake handle so the task registration completes.
   */
  class RecordingBashExecutor extends ShellExecutor {
    readonly requests: ShellExecRequest[] = []

    resolve(request: ShellExecRequest): ShellExecSpec {
      this.requests.push(request)
      return {
        command: request.command,
        workdir: request.workdir ?? process.cwd(),
        timeoutMs: request.timeoutMs ?? 0,
        stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
        ...request.signal ? { signal: request.signal } : {},
        ...request.stdin !== undefined ? { stdin: request.stdin } : {},
        ...request.env !== undefined ? { env: request.env } : {},
        ...request.dshEnv !== undefined ? { dshEnv: request.dshEnv } : {},
        sandboxPolicy: request.sandboxPolicy,
      }
    }
    run(): Promise<ShellRunResult> {
      return Promise.resolve({
        exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 0,
        stdout: { text: 'ok', truncated: false }, stderr: { text: '', truncated: false },
      })
    }
    start(): ShellProcess {
      return {
        status: 'completed',
        exitCode: 0,
        signal: null,
        done: Promise.resolve(),
        readOutput: () => ({ delta: '', lossy: false }),
        kill: () => false,
      }
    }
  }

  async function setupRecording() {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalJobRegistry)
    await ctx.plugin(ToolTasks)
    await ctx.plugin(BashEnvPlugin, { dshHome: recordingDshHome })
    await ctx.plugin(RecordingBashExecutor)
    await ctx.plugin(ToolBashFrames)
    return { ctx, bash: ctx.shell as RecordingBashExecutor }
  }

  it('describes the managed harness environment namespace to the model', async () => {
    const { ctx } = await setupRecording()
    const description = ctx.tools.get('multi_bash')?.description ?? ''
    expect(description).toContain('$DSH_*')
  })

  it('injects built-ins and the stable session id into a foreground request', async () => {
    const { ctx, bash } = await setupRecording()
    const agent = registerFakeAgent(ctx, 'request-fg', () => undefined)
    const ambient = process.env.DSH_SESSION_ID

    await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('session-env-fg'),
      name: 'multi_bash',
      arguments: { commands: [{ command: 'true' }], description: 'foreground batch receives session env built-ins' },
      agent,
    })

    expect(bash.requests[0]?.dshEnv).toEqual({
      DSH_HOME: recordingDshHome,
      DSH_SESSION_ID: 'request-fg',
      DSH_SHELL: '1',
    })
    expect(process.env.DSH_SESSION_ID).toBe(ambient)
  })

  it('injects the same trusted variables into a background element request without forwarding model env', async () => {
    const { ctx, bash } = await setupRecording()
    const agent = registerFakeAgent(ctx, 'request-bg', () => undefined)

    await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('session-env-bg'),
      name: 'multi_bash',
      arguments: {
        commands: [{
          command: 'sleep 1',
          run_in_background: true,
          env: { DSH_SESSION_ID: 'spoofed' },
        }],
        description: 'background element receives session env without forwarding model env',
      },
      agent,
    })

    expect(bash.requests[0]?.env).toBeUndefined()
    expect(bash.requests[0]?.dshEnv).toEqual({
      DSH_HOME: recordingDshHome,
      DSH_SESSION_ID: 'request-bg',
      DSH_SHELL: '1',
    })
  })

  it('keeps parent and child agent session environments isolated', async () => {
    const { ctx, bash } = await setupRecording()
    const parent = registerFakeAgent(ctx, 'request-parent', () => undefined)
    const child = registerFakeAgent(ctx, 'request-child', () => undefined)

    for (const [callId, agent] of [['parent', parent], ['child', child]] as const) {
      await ctx.tools.execute({
        signal: testToolSignal,
        callId: ToolCallId(`session-env-${callId}`),
        name: 'multi_bash',
        arguments: { commands: [{ command: 'true' }], description: 'parent and child batches keep isolated session envs' },
        agent,
      })
    }

    expect(bash.requests.map(request => request.dshEnv)).toEqual([
      {
        DSH_HOME: recordingDshHome,
        DSH_SESSION_ID: 'request-parent',
        DSH_SHELL: '1',
      },
      {
        DSH_HOME: recordingDshHome,
        DSH_SESSION_ID: 'request-child',
        DSH_SHELL: '1',
      },
    ])
  })

  it('does not forward trusted-only fields even when the model includes them as extra arguments', async () => {
    const { ctx, bash } = await setupRecording()
    // Unknown `env` and `stdin` keys are ignored by the schema and named request construction.
    // This preserves the request shape; it is not a security boundary because shell syntax can
    // already set environment variables or feed stdin.
    await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('no-forward-1'),
      name: 'multi_bash',
      arguments: {
        commands: [{ command: 'echo hi' }],
        env: { SNEAKY_API_KEY: 'leak' },
        stdin: 'malicious payload',
        stdoutMaxBytes: 999_999,
        description: 'trusted-only fields included as extra arguments must not be forwarded',
      },
    })
    expect(bash.requests).toHaveLength(1)
    const request = bash.requests[0]!
    expect(request.command).toBe('echo hi')
    expect('env' in request).toBe(false)
    expect('stdin' in request).toBe(false)
    expect('stdoutMaxBytes' in request).toBe(false)
  })

  it('a background element likewise carries no trusted-only fields', async () => {
    const { ctx, bash } = await setupRecording()
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('no-forward-2'),
      name: 'multi_bash',
      arguments: {
        commands: [{
          command: 'sleep 1',
          run_in_background: true,
          env: { TOKEN: 'leak' },
          stdin: 'x',
        }],
        stdoutMaxBytes: 999_999,
        description: 'a background element carries no trusted-only fields',
      },
    })
    // The call really went down the background path (the recorder sees the real
    // request the consumer built, so the absent env/stdin below is a real
    // negative, not a recorder that drops everything).
    expect(text(result)).toContain('started background job bash-1')
    expect(bash.requests).toHaveLength(1)
    const request = bash.requests[0]!
    expect(request.command).toBe('sleep 1')
    expect('env' in request).toBe(false)
    expect('stdin' in request).toBe(false)
    expect('stdoutMaxBytes' in request).toBe(false)
  })
})
