/**
 * Model-facing Consumer of the `ctx.shell` capability seam whose registered
 * `bash` tool carries the `commands` batch face as its only call shape: one
 * invocation fans out across independent shell jobs, each settling into its own
 * labeled frame while the wire contract stays one tool call to one tool result.
 * `run_in_background` rides single elements, so one element starts as a
 * background job without affecting its siblings. Sandboxing stays with the
 * session's own policy: the tool takes no per-call escalation fields.
 *
 * TODO(permissions): deployment policy belongs in `tools/pre-execute` and
 * sandboxing executors; see docs/architecture.md § Where new behavior goes.
 * @module @deepseek-ai/dsh-tool-bash-frames
 */

/* jscpd:ignore-start -- mirrors dsh-tool-bash validation, presentation, and
   dispatch side-by-side by design so the two bash consumers read together
   (multi-command-shell-calls Agent Note). */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { adviceLine } from '@deepseek-ai/dsh-system-prompt'
import { defineTool, TOOL_ABORTED, wrapSingletonArgs } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { } from '@deepseek-ai/dsh-jobs'
import type { } from '@deepseek-ai/dsh-user-approval'
import type { } from '@deepseek-ai/dsh-shell-env'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { DSH_ENV_PREFIX } from '@deepseek-ai/dsh-shell'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import { renderFrames } from '@deepseek-ai/dsh-shell'
import type { ShellFrameRecord, ShellRenderOutcome } from '@deepseek-ai/dsh-shell'
import { processOutcome } from './background.ts'
import { renderProcessRead } from '@deepseek-ai/dsh-shell'

export const name = 'tool-bash-frames'
export const inject = ['tools', 'shell', 'systemPrompt', 'shellEnv']

/** Configuration for the frames bash tool. */
export interface Config {
  /** Expose element `run_in_background` (default true); disabled elements are also rejected. */
  enableRunInBackground?: boolean
  /** Maximum elements one `commands` invocation may carry (default 8). */
  /** Register under the legacy `bash` name for recorded-session replay instead of the shipped `multi_bash` name (default false). */
  legacyName?: boolean
}

/** Runtime configuration schema for the frames bash tool plugin. */
export const Config: z<Config> = z.object({
  enableRunInBackground: z.boolean().default(true),
  legacyName: z.boolean().default(false),
})

/** Re-read the abort flag; a plain property read would be narrowed away after
 *  the loop-top check even though the approval await lets cancellation land. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/** One element of a `commands` invocation before validation defaults it. */
interface FramesCommandArgs {
  command: string
  workdir?: string
  timeoutMs?: number
  run_in_background?: boolean
}

/** Parsed tool args; execute validates value constraints absent from ParameterSchemaSpec. */
interface BashToolArgs {
  commands?: FramesCommandArgs[]
}

/** Validate a positive finite timeout value; the label names the failing argument. */
function validateTimeoutMs(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`invalid ${label}: expected a positive number, got ${JSON.stringify(value)}`)
  }
}

function validateBashArgs(args: BashToolArgs): void {
  if (!Array.isArray(args.commands) || args.commands.length === 0) {
    throw new Error('invalid commands: expected a non-empty array of command objects')
  }
  for (const element of args.commands) {
    if (typeof element.command !== 'string' || element.command.trim().length === 0) {
      throw new Error('invalid commands element: expected a non-empty command string')
    }
    validateTimeoutMs(element.timeoutMs, 'commands element timeoutMs')
  }
}

function bashDescription(backgroundEnabled: boolean): string {
  const background = backgroundEnabled
    ? 'Set `run_in_background: true` on an element to start it as a background job: its frame carries the job id; read its output with `job_output` and stop it with `job_kill`.'
    : 'Background execution is not available; elements must finish within the timeout.'
  const base = 'Execute bash commands (`bash -c`) and return their stdout/stderr. '
    + 'Pass a `commands` array: elements run in a fresh shell each, in written order, '
    + 'and every element runs even if an earlier one fails; keep steps that read an '
    + 'earlier output in separate calls, so the step that needs a result sees it. '
    + 'Each element settles on its own under a `[i/N] $ command` header (its own exit '
    + 'code, timeout, or sandbox marker). '
    + `Current harness environment facts are exposed through managed \`$${DSH_ENV_PREFIX}*\` variables; inspect them when needed. `
    + 'Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a bug in the command; do not retry another way. '
    + 'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. '
    + background
  return base
}

/** The frames-only arms of the canonical output union, with this tool's
 *  foreground duration stamp the shared shell outcome does not carry. */
type FramesOutcome =
  | ({ kind: 'foreground'; durationMs: number } & ShellRenderOutcome)
  | { kind: 'job'; jobId: string }
  | { kind: 'not-run'; reason: string }

type FramesValue = {
  kind: 'frames'
  frames: { index: number; command: string; outcome: FramesOutcome }[]
}

/** The schema-validated slice of bash args the presenters read; the core
 *  registry soft-validates every call before invoking a presenter. */
interface PresentBashArgs {
  commands: FramesCommandArgs[]
}

/**
 * Present a commands call as a generic execute card listing every element while
 * pending; one exit pill cannot represent several elements, so the terminal
 * card stays reserved for single-exit tools.
 */
function presentBashCall(args: PresentBashArgs): GenericCallView {
  const elements = args.commands
  const first = elements.at(0)
  return {
    card: 'generic',
    title: `${elements.length} commands: ${first?.command ?? ''}`,
    kind: 'execute',
    rawInput: JSON.stringify(elements),
    content: [{
      type: 'text',
      text: elements.map(element => `$ ${element.command}`).join('\n'),
    }],
  }
}

/**
 * Present completed output as generic fenced console text: a batch has several
 * exit statuses, so no terminal exit pill can represent the result.
 */
function presentBashResult(_args: unknown, result: ToolResult): ToolResultView | undefined {
  const block = result.content.length === 1 ? result.content[0] : undefined
  if (block === undefined || block.type !== 'text') return undefined
  return { card: 'generic', content: [{ type: 'text', text: `\`\`\`console\n${block.text.replace(/\n+$/, '')}\n\`\`\`` }] }
}

/**
 * Resolve an explicit workdir first, making a relative one session-workspace-relative;
 * otherwise use the filesystem identity of the session cwd and leave executor
 * defaulting as the fallback. A resolved sandbox-policy root wins so workdir
 * and confinement use the exact same per-call identity.
 */
function resolveWorkdir(
  modelWorkdir: string | undefined,
  exec: { agent?: Agent },
  policyWorkspaceRoot?: string,
): string | undefined {
  const headerCwd = exec.agent?.session.header.cwd
  const sessionCwd = policyWorkspaceRoot ?? (headerCwd === undefined ? undefined : canonicalPath(headerCwd))
  if (modelWorkdir === undefined) return sessionCwd
  if (sessionCwd !== undefined && !isAbsolute(modelWorkdir)) {
    return resolvePath(sessionCwd, modelWorkdir)
  }
  return modelWorkdir
}

/** Detach the executor DTO from readonly Service Definition types into plain JSON data. */
function canonicalBashResult(result: ShellRunResult, durationMs: number) {
  const output = (stream: ShellRunResult['stdout']) => ({
    text: stream.text,
    truncated: stream.truncated,
    ...stream.spillPath !== undefined ? { spillPath: stream.spillPath } : {},
  })
  return {
    durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    timeoutMs: result.timeoutMs,
    stdout: output(result.stdout),
    stderr: output(result.stderr),
    ...result.sandbox !== undefined ? {
      sandbox: {
        mode: result.sandbox.mode,
        denied: result.sandbox.denied,
        ...result.sandbox.enforcement !== undefined ? { enforcement: result.sandbox.enforcement } : {},
        ...result.sandbox.runnerFailed !== undefined ? { runnerFailed: result.sandbox.runnerFailed } : {},
      },
    } : {},
  }
}

/** Reused stream schema for stdout/stderr elements of the output union. */
const OUTPUT_STREAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    text: { type: 'string', required: true },
    truncated: { type: 'boolean', required: true },
    spillPath: { type: 'string' },
  },
} as const

export function apply(ctx: Context, config: Config = {}): void {
  const backgroundEnabled = config.enableRunInBackground ?? true
  // The shipped name is `multi_bash`; `legacyName` re-registers as `bash` so
  // recorded-session compositions resolve their recorded calls.
  const toolName = config.legacyName === true ? 'bash' : 'multi_bash'
  const defaultMode = ctx.shell.sandboxMode
  const sandboxPolicy: SandboxPolicyService | undefined = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
  if (defaultMode !== undefined && sandboxPolicy === undefined) {
    throw new Error('tool-bash-frames: the mounted bash executor confines but ctx.sandboxPolicy is missing')
  }
  /** Resolve the complete per-call policy (clamped by any narrowing listener) when a confining executor is mounted. */
  const resolveSandboxPolicy = async (exec: ToolExecution): Promise<SandboxExecutionPolicy | undefined> =>
    sandboxPolicy === undefined ? undefined : sandboxPolicy.resolveClamped(exec.agent === undefined ? {} : { session: exec.agent.session })

  // Cross-call guidance belongs in the prompt rather than one-call schema prose.
  ctx.systemPrompt.section({
    name: `tool:${toolName}`,
    order: ctx.systemPrompt.getSectionOrder('TOOL_BASH'),
    text: adviceLine('Bash covers builds, git, installs, and test runners, the work no structured tool performs; pass a short description so the user can follow what ran. Example: bash pnpm test with filter api after code changes, with description Run api package tests.')
      + ' Batch the independent steps of one thought into one `commands` call — one call running the narrowed test, grepping the symbol, and listing the directory instead of three calls; a step that reads an earlier output belongs in a later call. '
      + 'Check the [exit code: N] marker on every frame; investigate failures before moving on.',
  })

  ctx.tools.register(defineTool({
    name: toolName,
    description: bashDescription(backgroundEnabled),
    // Shape tolerance, not type tolerance: a model remembering the pre-batch
    // singleton `"{command: "…"}"` root receives one wrapped element, then
    // strict validation evaluates the wrapped form. String containers and
    // other non-conforming payloads fail validation outright.
    normalizeArgs: args => wrapSingletonArgs(args, 'commands', 'command'),
    parameters: {
      commands: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          // Permissive like the root schema: undeclared element keys reach
          // execute, where the background-disabled opt-out is enforced at
          // dispatch time.
          additionalProperties: true,
          properties: {
            command: { type: 'string', required: true, description: 'The bash command this element runs in its own fresh shell.' },
            workdir: { type: 'string', description: 'Working directory for this element; defaults to the session workspace, and a relative path is resolved against it.' },
            timeoutMs: { type: 'number', description: 'Timeout in milliseconds for this element; the executor applies its configured default and cap, and kills the element on expiry.' },
            ...backgroundEnabled ? {
              run_in_background: { type: 'boolean' as const, description: 'Run this element as a background job instead of waiting for it; its frame carries the job id, and job_output reads its output.' },
            } : {},
          },
        },
        description: 'The batch of independent shell jobs, in written order and a fresh shell each. Only steps that do not need each other\'s output belong in one call; a step that reads an earlier result goes in a later call. Every element settles into its own labeled frame with its exit code, timeout, sandbox marker, or background job id, and every element runs even if an earlier one fails.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'frames' },
          frames: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'integer', required: true },
                command: { type: 'string', required: true },
                outcome: {
                  required: true,
                  oneOf: [
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        kind: { type: 'string', required: true, const: 'foreground' },
                        durationMs: { type: 'integer', required: true },
                        exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
                        signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
                        timedOut: { type: 'boolean', required: true },
                        aborted: { type: 'boolean', required: true },
                        timeoutMs: { type: 'number', required: true },
                        stdout: OUTPUT_STREAM_SCHEMA,
                        stderr: OUTPUT_STREAM_SCHEMA,
                        sandbox: {
                          type: 'object',
                          additionalProperties: false,
                          properties: {
                            mode: { type: 'string', required: true },
                            denied: { type: 'boolean', required: true },
                            enforcement: { type: 'string' },
                            runnerFailed: { type: 'boolean' },
                          },
                        },
                      },
                    },
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        kind: { type: 'string', required: true, const: 'job' },
                        jobId: { type: 'string', required: true },
                      },
                    },
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        kind: { type: 'string', required: true, const: 'not-run' },
                        reason: { type: 'string', required: true },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderFrames((value as FramesValue).frames as ShellFrameRecord[]),
      }],
      presentationMeta: (_args, value) => ({
        frames: (value as FramesValue).frames.map(frame => ({
          index: frame.index,
          ...frame.outcome.kind === 'foreground' ? { durationMs: frame.outcome.durationMs } : {},
        })),
      }),
    },
    async execute(args: BashToolArgs, exec) {
      validateBashArgs(args)
      // Description is display metadata; workdir defaults to the caller's session.
      const standingPolicy = await resolveSandboxPolicy(exec)
      const dshEnv = ctx.shellEnv.collect(exec)
      return executeFrames(args, exec, standingPolicy, dshEnv)
    },
    presentCall: presentBashCall,
    presentResult: presentBashResult,
  }))

  /** Detach one shell child onto `ctx.jobs`; the job owns cancellation from commit. */
  function startBackgroundJob(
    exec: ToolExecution,
    label: string,
    request: Parameters<typeof ctx.shell.resolve>[0],
  ): string {
    const jobs = ctx.get('jobs')
    if (jobs === undefined) {
      throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
    }
    return jobs.start({
      kind: 'bash',
      label,
      ...exec.agent ? { owner: exec.agent } : {},
      run: () => {
        const proc = ctx.shell.start(ctx.shell.resolve(request))
        return {
          cancel: () => void proc.kill(),
          done: proc.done.then(() => processOutcome(proc)),
          readOutput: () => renderProcessRead(proc.readOutput(), proc.sandbox),
        }
      },
    })
  }

  /** Several commands per call: serial element dispatch into labeled frames. */
  async function executeFrames(
    args: BashToolArgs,
    exec: ToolExecution,
    standingPolicy: SandboxExecutionPolicy | undefined,
    dshEnv: ReturnType<typeof ctx.shellEnv.collect>,
  ): Promise<FramesValue> {
    const baseWorkdir = resolveWorkdir(undefined, exec, standingPolicy?.workspaceRoot)
    const elements = args.commands as FramesCommandArgs[]
    const frames: FramesValue['frames'] = []
    for (const [index, element] of elements.entries()) {
      if (exec.signal.aborted) {
        frames.push({ index, command: element.command, outcome: { kind: 'not-run', reason: 'call aborted' } })
        continue
      }
      // A cancellation landing between elements must not detach work the
      // caller stopped asking for; read the flag through a call so the
      // compiler's property narrowing cannot elide a cancel that lands mid-batch.
      if (isAborted(exec.signal)) {
        if (element.run_in_background === true) {
          const error = new HarnessError('tool call aborted', TOOL_ABORTED)
          error.name = 'AbortError'
          throw error
        }
        frames.push({ index, command: element.command, outcome: { kind: 'not-run', reason: 'call aborted' } })
        continue
      }
      const workdir = element.workdir !== undefined
        ? resolveWorkdir(element.workdir, exec, standingPolicy?.workspaceRoot)
        : baseWorkdir
      const request = {
        command: element.command,
        ...workdir !== undefined ? { workdir } : {},
        ...element.timeoutMs !== undefined ? { timeoutMs: element.timeoutMs } : {},
        dshEnv,
        ...standingPolicy !== undefined ? { sandboxPolicy: standingPolicy } : {},
      }
      if (element.run_in_background === true) {
        if (!backgroundEnabled) {
          throw new Error('run_in_background is disabled for this deployment (enableRunInBackground: false)')
        }
        const id = startBackgroundJob(exec, element.command, request)
        frames.push({ index, command: element.command, outcome: { kind: 'job', jobId: id } })
        continue
      }
      const startedAt = Date.now()
      const result = await ctx.shell.run(ctx.shell.resolve({
        ...request,
        signal: exec.signal,
      }))
      if (result.aborted) {
        const error = new HarnessError('tool call aborted', TOOL_ABORTED)
        error.name = 'AbortError'
        throw error
      }
      frames.push({ index, command: element.command, outcome: { kind: 'foreground', ...canonicalBashResult(result, Date.now() - startedAt) } })
    }
    return { kind: 'frames', frames }
  }
}
/* jscpd:ignore-end */
