import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { ShellExecutor } from '@deepseek-ai/dsh-shell'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { TOOL_ABORTED as ABORT_CODE } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as ToolTasks from '@deepseek-ai/dsh-tool-jobs'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import * as ToolBashFrames from '@deepseek-ai/dsh-tool-bash-frames'

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-tool-bash-frames-spec-'))

afterAll(() => {
  rmSync(spillDir, { recursive: true, force: true })
})

/** REAL-composition harness over the local bash executor plus the job runtime. */
async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalJobRegistry)
  await ctx.plugin(ToolTasks)
  await ctx.plugin(LocalSubprocessRuntime)
  ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, graceMs: 200 })
  await ctx.plugin(ToolBashFrames)
  return ctx
}

/** Executor whose confessed run reports a sandbox denial for one command. */
class DenyingSandboxExecutor extends ShellExecutor {
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
    const denied = spec.command.includes('write-now')
    return Promise.resolve({
      exitCode: denied ? 1 : 0,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: denied ? '' : 'ok', truncated: false },
      stderr: { text: '', truncated: false },
      sandbox: { mode: spec.sandboxPolicy?.mode ?? 'read-only', denied },
    })
  }

  start(): never {
    throw new Error('unused')
  }
}

/** Executor whose first foreground run aborts the call signal mid-loop. */
class AbortOnFirstRunExecutor extends ShellExecutor {
  /** Set by the test; invoked once on the first run to abort the call signal. */
  abortCall: (() => void) | undefined

  resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      timeoutMs: request.timeoutMs ?? 1000,
      ...request.signal ? { signal: request.signal } : {},
      ...request.sandboxPolicy !== undefined ? { sandboxPolicy: request.sandboxPolicy } : {
        sandboxPolicy: { mode: 'read-only' as const, workspaceRoot: process.cwd() },
      },
    }
  }

  run(spec: ShellExecSpec): Promise<ShellRunResult> {
    // The element loop re-checks the call signal before the next dispatch,
    // so aborting here settles element 1 into its not-run frame.
    this.abortCall?.()
    this.abortCall = undefined
    return Promise.resolve({
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: 'first-ran', truncated: false },
      stderr: { text: '', truncated: false },
    })
  }

  start(): never {
    throw new Error('unused')
  }
}

/** Executor whose runs confess `aborted` instead of relying on the call signal. */
class AbortedResultExecutor extends ShellExecutor {
  resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      timeoutMs: request.timeoutMs ?? 1000,
      sandboxPolicy: { mode: 'read-only' as const, workspaceRoot: request.workdir ?? process.cwd() },
    }
  }

  run(spec: ShellExecSpec): Promise<ShellRunResult> {
    return Promise.resolve({
      exitCode: null,
      signal: null,
      timedOut: false,
      aborted: true,
      timeoutMs: spec.timeoutMs,
      stdout: { text: '', truncated: false },
      stderr: { text: '', truncated: false },
    })
  }

  start(): never {
    throw new Error('unused')
  }
}

function call(ctx: Context, args: unknown, signal?: AbortSignal) {
  return ctx.tools.execute({
    signal: signal ?? new AbortController().signal,
    callId: ToolCallId(`frames-${Math.random()}`),
    name: 'bash',
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('the commands face', () => {
  it('runs every element to its own frame, in written order, earlier failures included', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      description: 'Run three independent checks',
      commands: [
        { command: 'echo first' },
        { command: 'exit 7' },
        { command: 'echo third' },
      ],
    })
    expect(result.isError).not.toBe(true)
    const rendered = text(result)
    const firstHeader = rendered.indexOf('[1/3] $ echo first')
    const secondHeader = rendered.indexOf('[2/3] $ exit 7')
    const thirdHeader = rendered.indexOf('[3/3] $ echo third')
    expect(firstHeader).toBeGreaterThanOrEqual(0)
    expect(secondHeader).toBeGreaterThan(firstHeader)
    expect(thirdHeader).toBeGreaterThan(secondHeader)
    expect(rendered).toContain('first')
    expect(rendered).toContain('[exit code: 7]')
    expect(rendered).toContain('third')
    // Clean sections emit no exit marker: only failures are marked, so the
    // marker text appears exactly once (the exit-7 element).
    expect(rendered.match(/\[exit code: \d+\]/g)).toEqual(['[exit code: 7]'])
  })

  it('starts a background element as a real job and labels its frame with the id', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      description: 'One foreground and one background element',
      commands: [
        { command: 'echo fg' },
        { command: 'sleep 0.2; echo bg-done', run_in_background: true },
      ],
    })
    expect(result.isError).not.toBe(true)
    const rendered = text(result)
    expect(rendered).toContain('[1/2] $ echo fg')
    expect(rendered).toContain('fg')
    const jobLine = rendered.split('\n').find(line => line.startsWith('started background job '))!
    expect(jobLine).toBeDefined()
    const jobId = jobLine.slice('started background job '.length)
    expect(jobId.length).toBeGreaterThan(0)
    const read = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('frames-read'),
      name: 'job_output',
      arguments: { job_id: jobId, timeout_ms: 3_000 },
    })
    expect(text(read)).toContain('bg-done')
  })

  it('marks the remaining elements not-run once the call signal aborts mid-loop', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(AbortOnFirstRunExecutor)
    await ctx.plugin(ToolBashFrames)
    const controller = new AbortController()
    ;(ctx.shell as AbortOnFirstRunExecutor).abortCall = () => {
      controller.abort()
    }
    // Invoke the tool body directly: the scheduler overlays a bare abort error on
    // any caller-cancelled call, so the frames the loop itself settles are only
    // observable here.
    const tool = ctx.tools.get('bash')!
    const value = await (tool.execute as (args: unknown, exec: unknown) => Promise<unknown>)(
      { description: 'Batch interrupted after the first element', commands: [{ command: 'echo a' }, { command: 'echo b' }] },
      { signal: controller.signal, callId: ToolCallId('frames-direct') },
    )
    expect(value).toMatchObject({ kind: 'frames' })
    const frames = (value as { frames: { command: string; outcome: { kind: string; reason?: string } }[] }).frames
    expect(frames).toHaveLength(2)
    expect(frames[0]!.outcome.kind).toBe('foreground')
    expect(frames[1]!.outcome).toEqual({ kind: 'not-run', reason: 'call aborted' })
    // Through the registry the same call settles as the abort error contract.
    const viaScheduler = await call(ctx, {
      description: 'Aborted batch',
      commands: [{ command: 'echo a' }, { command: 'echo b' }],
    }, controller.signal)
    expect(viaScheduler.isError).toBe(true)
  })

  it('keeps the sandbox denial marker inside the denied element alone', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(SessionProjectionRegistry)
    ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
    await ctx.plugin(SandboxPolicyService, {})
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(DenyingSandboxExecutor)
    await ctx.plugin(ToolBashFrames)
    const result = await call(ctx, {
      description: 'One allowed and one denied element',
      commands: [{ command: 'echo read-ok' }, { command: 'write-now >&2' }],
    })
    const rendered = text(result)
    expect(rendered).toContain('read-ok')
    expect(rendered).toContain('[sandbox: file access denied under read-only mode]')
    const deniedSection = rendered.slice(rendered.indexOf('[2/2]'))
    expect(deniedSection).toContain('[sandbox: file access denied under read-only mode]')
    expect(rendered.slice(0, rendered.indexOf('[2/2]'))).not.toContain('[sandbox:')
  })

  it('fails the whole invocation when a background element is asked while backgrounding is off', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, graceMs: 200 })
    await ctx.plugin(ToolBashFrames, { enableRunInBackground: false })
    const result = await call(ctx, {
      description: 'Background despite the flag',
      commands: [{ command: 'echo x', run_in_background: true }],
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('run_in_background is disabled')
  })

  it('caps the element count at the configured maximum', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, graceMs: 200 })
    await ctx.plugin(ToolBashFrames, { maxCommandsPerCall: 2 })
    const result = await call(ctx, {
      description: 'Three elements over a cap of two',
      commands: [{ command: 'echo a' }, { command: 'echo b' }, { command: 'echo c' }],
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('at most 2 elements')
  })

  it('presents a pending frames call as a generic execute card listing every command', async () => {
    const ctx = await setup()
    const view = ctx.tools.get('bash')!.presentCall!({
      description: 'Two checks',
      commands: [{ command: 'echo a' }, { command: 'git status' }],
    }) as { card: string; kind?: string; title?: string; content?: { type: string; text?: string }[] }
    expect(view.card).toBe('generic')
    expect(view.kind).toBe('execute')
    expect(view.title).toBe('2 commands: echo a')
    expect(view.content?.[0]?.type).toBe('text')
    expect(view.content?.[0]?.text).toBe('$ echo a\n$ git status')
  })

  it('resolves element workdir and timeout overrides into the dispatch request', async () => {
    const ctx = await setup()
    const result = await call(ctx, {
      description: 'One element with its own workdir',
      commands: [{ command: 'pwd', workdir: '.', timeoutMs: 9_000 }],
    })
    expect(result.isError).not.toBe(true)
    expect(text(result)).toContain('[1/1] $ pwd')
  })

  it('rejects a blanket description but lets a real element label through', async () => {
    const ctx = await setup()
    const blank = await call(ctx, {
      description: 'Blank label',
      commands: [{ command: 'echo a', description: '  ' }],
    })
    expect(blank.isError).toBe(true)
    expect(text(blank)).toContain('invalid commands element description')
    const labeled = await call(ctx, {
      description: 'Real label',
      commands: [{ command: 'echo a', description: 'Say hello' }],
    })
    expect(labeled.isError).not.toBe(true)
  })

  it('fails the element loop with the abort contract when an executor confesses aborted', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(AbortedResultExecutor)
    await ctx.plugin(ToolBashFrames)
    const tool = ctx.tools.get('bash')!
    await expect((tool.execute as (args: unknown, exec: unknown) => Promise<unknown>)(
      { description: 'Aborting executor', commands: [{ command: 'echo a' }] },
      { signal: new AbortController().signal, callId: ToolCallId('frames-aborting') },
    )).rejects.toMatchObject({ name: 'AbortError', code: ABORT_CODE })
  })

  it('leaves the background element key undeclared when backgrounding is off', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, graceMs: 200 })
    await ctx.plugin(ToolBashFrames, { enableRunInBackground: false })
    const schema = ctx.tools.schemas().find(candidate => candidate.name === 'bash')!
    const items = (schema.parameters.properties as { commands: { items: { properties: Record<string, unknown> } } }).commands.items
    expect(items.properties).not.toHaveProperty('run_in_background')
    const result = await call(ctx, {
      description: 'Background element',
      commands: [{ command: 'echo a', run_in_background: true }],
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('run_in_background is disabled')
  })

  it('renders every outcome arm through its output renderer', async () => {
    const ctx = await setup()
    const tool = ctx.tools.get('bash')!
    const render = (tool as unknown as {
      output: { render: (args: unknown, value: unknown) => { type: string; text: string }[] }
    }).output.render
    const rendered = render({}, {
      kind: 'frames',
      frames: [
        { index: 0, command: 'echo a', outcome: { kind: 'job', jobId: 'bash-42' } },
        { index: 1, command: 'echo b', outcome: { kind: 'not-run', reason: 'call aborted' } },
      ],
    }).map(block => block.text).join('')
    expect(rendered).toContain('[1/2] $ echo a\nstarted background job bash-42')
    expect(rendered).toContain('[2/2] $ echo b\n[not run: call aborted]')
  })

  it('presents empty batches and invalid results as generic cards', async () => {
    const ctx = await setup()
    const tool = ctx.tools.get('bash')!
    const emptyView = tool.presentCall!({ description: 'No commands', commands: [] }) as {
      card: string
      title?: string
      content?: { type: string; text: string }[]
    }
    expect(emptyView.title).toBe('0 commands: ')
    expect(emptyView.content?.[0]?.text).toBe('')
    const invalid = tool.presentResult!({ description: 'd', commands: [{ command: 'x' }] }, {
      content: [{ type: 'text', text: 'raw' }],
      isError: true,
    }) as { card: string }
    expect(invalid.card).toBe('generic')
  })

  it('presents a settled frames result as fenced output, never a terminal pill', async () => {
    const ctx = await setup()
    const tool = ctx.tools.get('bash')!
    const executed = await call(ctx, {
      description: 'One element',
      commands: [{ command: 'echo one' }],
    })
    const view = tool.presentResult!({ description: 'd', commands: [{ command: 'echo one' }] }, executed) as
      | { card: string; content?: { type: string; text?: string }[]; output?: string }
      | undefined
    expect(view?.card).toBe('generic')
    expect(view?.content?.[0]?.text).toContain('[1/1] $ echo one')
    expect(view).not.toHaveProperty('output')
  })
})

describe('presentation and config edges', () => {
  it('soft-validates presentCall args: a call without the batch yields no view', async () => {
    const ctx = await setup()
    const tool = ctx.tools.get('bash')!
    expect(tool.presentCall!({ description: 'Start later' })).toBeUndefined()
  })

  it('presentCall yields no view for a schema-invalid batch', async () => {
    const ctx = await setup()
    // The core wrapper soft-validates replay args before the presenter runs,
    // so a non-array batch settles to the generic undefined-view fallback.
    expect(ctx.tools.get('bash')!.presentCall!({
      description: 'Guard',
      commands: null,
    } as never)).toBeUndefined()
  })

  it('presents non-object args and multi-block results without a view', async () => {
    const ctx = await setup()
    const tool = ctx.tools.get('bash')!
    const primitiveArgs = tool.presentResult!(7, {
      content: [{ type: 'text', text: 'raw' }],
      isError: false,
    }) as { card: string } | undefined
    expect(primitiveArgs).toBeUndefined()
    const nullifiedArgs = tool.presentResult!(nullArgs(), {
      content: [{ type: 'text', text: 'raw' }],
      isError: false,
    }) as { card: string } | undefined
    expect(nullifiedArgs).toBeUndefined()
    const multiBlock = tool.presentResult!({ description: 'd' }, {
      content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
      isError: false,
    })
    expect(multiBlock).toBeUndefined()
  })

  it('refuses a background element at dispatch time when backgrounding is off', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(BashEnvPlugin)
    await ctx.plugin(LocalBashExecutor, { timeoutMs: 10_000, graceMs: 200 })
    await ctx.plugin(ToolBashFrames, { enableRunInBackground: false })
    const tool = ctx.tools.get('bash')!
    await expect((tool.execute as (args: unknown, exec: unknown) => Promise<unknown>)(
      { description: 'd', commands: [{ command: 'echo x', run_in_background: true }] },
      { signal: new AbortController().signal, callId: ToolCallId('frames-bg-off-direct') },
    )).rejects.toThrow('run_in_background is disabled')
  })
})

/** Null args reaching a raw presenter call degrade to the terminal pill parse. */
function nullArgs(): unknown {
  return null
}
