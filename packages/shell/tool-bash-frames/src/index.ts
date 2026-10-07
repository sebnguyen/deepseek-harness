/**
 * Model-facing Consumer of the `ctx.shell` capability seam whose registered
 * `bash` tool carries the v1 singular surface plus a `commands` batch face: one
 * invocation fans out across independent shell jobs, each settling into its own
 * labeled frame while the wire contract stays one tool call to one tool result.
 * Background elements register process handles with `ctx.jobs`; their work uses
 * job cancellation rather than the tool-call signal after an id is returned.
 *
 * TODO(permissions): deployment policy belongs in `tools/pre-execute` and
 * sandboxing executors; see docs/architecture.md § Where new behavior goes.
 * @module @deepseek-ai/dsh-tool-bash-frames
 */

/* jscpd:ignore-start -- mirrors dsh-tool-bash call-for-call by design: the frames
   provider keeps the singular bash concept intact and adds the commands face,
   so validation, presentation, escalation, and dispatch read side-by-side
   (multi-command-shell-calls Agent Note). */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { adviceLine } from '@deepseek-ai/dsh-system-prompt'
import { defineTool, TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, TerminalCallView, ToolExecution, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { } from '@deepseek-ai/dsh-jobs'
import type { } from '@deepseek-ai/dsh-user-approval'
import type { } from '@deepseek-ai/dsh-shell-env'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { EscalationApproval } from '@deepseek-ai/dsh-sandbox'
import { ESCALATION_TARGETS, approveEscalation, canonicalPath, validateEscalationArgs } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { DSH_ENV_PREFIX } from '@deepseek-ai/dsh-shell'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import { renderFrames } from '@deepseek-ai/dsh-shell'
import type { ShellFrameOutcome, ShellFrameRecord } from '@deepseek-ai/dsh-shell'
import { processOutcome } from './background.ts'
import { parseExitStatus, renderProcessRead, renderResult } from '@deepseek-ai/dsh-shell'

export const name = 'tool-bash-frames'
export const inject = ['tools', 'shell', 'systemPrompt', 'shellEnv']

/** Configuration for the frames bash tool. */
export interface Config {
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  enableRunInBackground?: boolean
  /** Maximum elements one `commands` invocation may carry (default 8). */
  maxCommandsPerCall?: number
}

/** Runtime configuration schema for the frames bash tool plugin. */
export const Config: z<Config> = z.object({
  enableRunInBackground: z.boolean().default(true),
  maxCommandsPerCall: z.number().step(1).min(1).default(8),
})

/** One element of a `commands` invocation before validation defaults it. */
interface FramesCommandArgs {
  command: string
  description?: string
  workdir?: string
  timeoutMs?: number
  run_in_background?: boolean
}

/** Parsed tool args; execute validates value constraints absent from ParameterSchemaSpec. */
interface BashToolArgs {
  command?: string
  commands?: FramesCommandArgs[]
  description: string
  timeoutMs?: number
  workdir?: string
  run_in_background?: boolean
  sandbox_permissions?: string
  justification?: string
}

/** Validate a positive finite timeout value; the label names the failing argument. */
function validateTimeoutMs(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`invalid ${label}: expected a positive number, got ${JSON.stringify(value)}`)
  }
}

function validateBashArgs(args: BashToolArgs, maxCommandsPerCall: number): void {
  if (args.description.trim().length === 0) {
    throw new Error('invalid description: expected a non-empty string')
  }
  if (args.commands === undefined) {
    if (typeof args.command !== 'string' || args.command.trim().length === 0) {
      throw new Error('invalid command: expected a non-empty string')
    }
    validateTimeoutMs(args.timeoutMs, 'timeoutMs')
    // The escalation pairing (sandbox_permissions ⇔ justification, non-empty) is
    // the shared rule both enforcing families validate identically.
    validateEscalationArgs(args.sandbox_permissions, args.justification)
    return
  }
  if (args.command !== undefined) {
    throw new Error('invalid args: `command` and `commands` are mutually exclusive')
  }
  if (!Array.isArray(args.commands) || args.commands.length === 0) {
    throw new Error('invalid commands: expected a non-empty array of command objects')
  }
  if (args.commands.length > maxCommandsPerCall) {
    throw new Error(`invalid commands: at most ${maxCommandsPerCall} elements, got ${args.commands.length}`)
  }
  // v1 keeps escalation singular-only so widened authority never rides an array.
  validateEscalationArgs(args.sandbox_permissions, args.justification)
  if (args.sandbox_permissions !== undefined) {
    throw new Error('invalid args: sandbox_permissions applies to one-command calls only')
  }
  validateTimeoutMs(args.timeoutMs, 'timeoutMs')
  for (const element of args.commands) {
    if (typeof element.command !== 'string' || element.command.trim().length === 0) {
      throw new Error('invalid commands element: expected a non-empty command string')
    }
    if (element.description !== undefined && element.description.trim().length === 0) {
      throw new Error('invalid commands element description: expected a non-empty string')
    }
    validateTimeoutMs(element.timeoutMs, 'commands element timeoutMs')
  }
}

function bashDescription(backgroundEnabled: boolean, escalationModes: readonly SandboxMode[]): string {
  const background = backgroundEnabled
    ? 'Set `run_in_background: true` for long-running commands: the call returns a job id immediately; read its output with `job_output` and stop it with `job_kill`.'
    : 'Background execution is not available; long-running commands must finish within the timeout.'
  const base = 'Execute a bash command (`bash -c`) and return its stdout/stderr. '
    + 'Each call runs in a fresh shell: no state (cwd, variables, functions) persists between calls — '
    + 'pass `workdir` instead of using `cd`. Non-zero exits are reported as `[exit code: N]`. '
    + 'Pass a `commands` array to run several independent commands in one call: elements run in '
    + 'written order, each settles on its own under a `[i/N] $ command` header (its own exit code, '
    + 'timeout, or sandbox marker), and every element runs even if an earlier one fails; keep steps '
    + 'that read an earlier output in separate calls. '
    + `Current harness environment facts are exposed through managed \`$${DSH_ENV_PREFIX}*\` variables; inspect them when needed. `
    + 'Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a bug in the command; do not retry another way. '
    + 'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. '
    + background
  if (escalationModes.length === 0) return base
  return base + ' Attempting a command the sandbox may deny is safe and expected: run it and read the '
    + 'marker rather than assuming the denial. When a command is denied and a wider mode would let it '
    + 'succeed, escalate immediately in the same turn — the one sanctioned exception to a denial: retry '
    + 'the exact same command once with `sandbox_permissions` (the narrowest wider mode that suffices) '
    + 'plus a one-sentence `justification`. Do not detour through chat to ask permission first — the '
    + 'approval prompt raised by that retry is how the user consents. If the session states approval '
    + 'prompts are disabled, there is no exception: a denial is final — do not set `sandbox_permissions`. '
    + 'Never escalate speculatively: ground the request in a real denial — normally the one this command '
    + 'just hit; escalating up front is fine only when this session already denied the same access. '
    + 'A rejected escalation is final for that command — stop and explain, never work around '
    + 'it — but it does not forbid attempting or escalating other commands later.'
}

/**
 * The frames tool's contribution to the shared escalation sequence:
 * reject `sandbox_permissions` in compositions whose executor never
 * advertised sandboxing (schema validation checks advertised keys only,
 * so an unadvertised field still reaches execute), then delegate strict
 * widening, channel resolution, and outcome mapping to
 * {@link approveEscalation}. Module-level so the composition guard is
 * testable directly instead of only through the schema-gated execute.
 * @param facts - the composition's escalation targets plus the approval route
 *   (approver, agent, call id, abort signal).
 * @param requestedMode - the wider sandbox mode this one-shot retry asks for.
 * @param justification - the one-sentence user-facing reason.
 * @param standingPolicy - the call's resolved sandbox policy, whose mode is the
 *   strict-widening baseline; required whenever escalation is composed.
 * @returns the granted mode, consumed by the one call that asked.
 */
export async function requestBashEscalation(
  facts: {
    escalationModes: readonly SandboxMode[]
    approver: EscalationApproval<Agent, ToolCallId>['approver']
    agent: Agent | undefined
    callId: ToolCallId
    signal: AbortSignal
  },
  requestedMode: string,
  justification: string,
  standingPolicy: SandboxExecutionPolicy | undefined,
): Promise<SandboxMode> {
  if (facts.escalationModes.length === 0) {
    throw new Error('sandbox_permissions is not available in this composition (no sandboxing executor to escalate)')
  }
  const effectiveMode = (standingPolicy as SandboxExecutionPolicy).mode
  return approveEscalation<Agent, ToolCallId>(
    { requestedMode, justification, effectiveMode, subject: 'command' },
    {
      approver: facts.approver,
      agent: facts.agent,
      callId: facts.callId,
      toolName: 'bash',
      signal: facts.signal,
    },
  )
}

/** Canonical shape of one foreground element or singular result. */
type ForegroundFrameValue =
  & { kind: 'foreground' }
  & ReturnType<typeof canonicalBashResult>

/** The frames-only arms of the canonical output union. */
type FramesValue = {
  kind: 'frames'
  frames: { index: number; command: string; outcome: ShellFrameOutcome }[]
}

/**
 * Present foreground calls as terminals, background starts and multi-command
 * calls as generic cards; the frame list is the card body so every element's
 * command stays visible while pending.
 */
function presentBashCall(args: BashToolArgs): GenericCallView | TerminalCallView {
  if (args.commands !== undefined) {
    const first = args.commands.at(0)
    return {
      card: 'generic',
      title: `${args.commands.length} commands: ${first?.command ?? ''}`,
      kind: 'execute',
      rawInput: JSON.stringify(args.commands),
      content: [{
        type: 'text',
        text: args.commands.map(element => `$ ${element.command}`).join('\n'),
      }],
    }
  }
  if (args.run_in_background === true) {
    return {
      card: 'generic',
      title: args.command ?? '',
      kind: 'execute',
      rawInput: args.command ?? '',
      content: [{ type: 'text', text: args.description }],
    }
  }
  return {
    card: 'terminal',
    title: args.command ?? '',
    description: args.description,
    ...args.workdir !== undefined ? { cwd: args.workdir } : {},
  }
}

/**
 * Present completed foreground output as a terminal; background acknowledgements,
 * frames, and execution errors use generic fenced output without a pill, because
 * one exit pill cannot represent several elements.
 */
function presentBashResult(args: unknown, result: ToolResult): ToolResultView | undefined {
  const block = result.content.length === 1 ? result.content[0] : undefined
  if (block === undefined || block.type !== 'text') return undefined
  const raw = block.text
  const record = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {}
  // Frames, background acknowledgements and errors have no terminal exit status.
  if (record['run_in_background'] === true || record['commands'] !== undefined || result.isError) {
    return { card: 'generic', content: [{ type: 'text', text: `\`\`\`console\n${raw.replace(/\n+$/, '')}\n\`\`\`` }] }
  }
  // The exit marker becomes the card's exit pill, so it leaves the output body.
  const { body, ...exit } = parseExitStatus(raw)
  return { card: 'terminal', output: body, ...exit }
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
function canonicalBashResult(result: ShellRunResult) {
  const output = (stream: ShellRunResult['stdout']) => ({
    text: stream.text,
    truncated: stream.truncated,
    ...stream.spillPath !== undefined ? { spillPath: stream.spillPath } : {},
  })
  return {
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

/** Canonical background-handle properties shared by the bash output union. */
const BACKGROUND_OUTPUT_PROPERTIES = {
  kind: { type: 'string', required: true, const: 'background' },
  jobId: { type: 'string', required: true },
} as const

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
  const maxCommandsPerCall = config.maxCommandsPerCall ?? 8
  const defaultMode = ctx.shell.sandboxMode
  const escalationModes: readonly SandboxMode[] = defaultMode === undefined ? [] : ESCALATION_TARGETS
  const sandboxPolicy: SandboxPolicyService | undefined = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
  if (defaultMode !== undefined && sandboxPolicy === undefined) {
    throw new Error('tool-bash-frames: the mounted bash executor confines but ctx.sandboxPolicy is missing')
  }
  /** Resolve the complete per-call policy (clamped by any narrowing listener) when a confining executor is mounted. */
  const resolveSandboxPolicy = async (exec: ToolExecution): Promise<SandboxExecutionPolicy | undefined> =>
    sandboxPolicy === undefined ? undefined : sandboxPolicy.resolveClamped(exec.agent === undefined ? {} : { session: exec.agent.session })

  /**
   * Resolve a sandbox-escalation request through `ctx.approval` BEFORE
   * anything executes: composition guard and fail-closed sequence live in
   * {@link requestBashEscalation}; this plugin supplies only the approval
   * ingredients and the standing mode.
   */
  const approveBashEscalation = (
    mode: string,
    justification: string,
    exec: ToolExecution,
    standingPolicy: SandboxExecutionPolicy | undefined,
  ): Promise<SandboxMode> =>
    requestBashEscalation(
      {
        escalationModes,
        approver: ctx.get('approval'),
        agent: exec.agent,
        callId: exec.callId,
        signal: exec.signal,
      },
      mode,
      justification,
      standingPolicy,
    )

  // Cross-call guidance belongs in the prompt rather than one-call schema prose.
  ctx.systemPrompt.section({
    name: 'tool:bash',
    order: ctx.systemPrompt.getSectionOrder('TOOL_BASH'),
    text: adviceLine('Bash covers builds, git, installs, and test runners, the work no structured tool performs; pass a short description so the user can follow what ran. Example: bash pnpm test with filter api after code changes, with description Run api package tests.')
      + ' Use `commands` when independent shell work arrives together — one call running the narrowed test, grepping the symbol, and listing the directory. '
      + 'Check the [exit code: N] marker on every bash result; investigate failures before moving on.',
  })

  ctx.tools.register(defineTool({
    name: 'bash',
    description: bashDescription(backgroundEnabled, escalationModes),
    parameters: {
      command: { type: 'string', description: 'The bash command to execute. Mutually exclusive with `commands`.' },
      commands: {
        type: 'array',
        items: {
          type: 'object',
          // Permissive like the singular root schema: undeclared element keys
          // (e.g. `run_in_background` while `enableRunInBackground: false`)
          // reach execute, where the opt-out is enforced at dispatch time.
          additionalProperties: true,
          properties: {
            command: { type: 'string', required: true, description: 'The bash command for this element.' },
            description: { type: 'string', description: 'One-line UI label for this element; defaults to the command text.' },
            workdir: { type: 'string', description: 'Working directory override for this element.' },
            timeoutMs: { type: 'number', description: 'Timeout override in milliseconds for this element.' },
            ...backgroundEnabled ? {
              run_in_background: { type: 'boolean' as const, description: 'Run this element in the background; its frame carries the job id.' },
            } : {},
          },
        },
        description: 'Independent bash commands to run in one call, in written order; each element settles into its own labeled frame.',
      },
      description: {
        type: 'string',
        required: true,
        description: 'Clear, concise description of what this command does in active voice, '
          + '5-10 words (shown in the UI). Examples: "ls" → "List files in current directory"; '
          + '"git status" → "Show working tree status"; "npm install" → "Install package dependencies".',
      },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.' },
      workdir: { type: 'string', description: 'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it.' },
      ...backgroundEnabled ? {
        run_in_background: { type: 'boolean' as const, description: 'Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies.' },
      } : {},
      ...escalationModes.length > 0 ? {
        sandbox_permissions: {
          type: 'string' as const,
          enum: [...escalationModes],
          description: 'The wider sandbox mode this command needs. Only valid as a one-shot retry of a command the sandbox just denied; requires justification and user approval.',
        },
        justification: {
          type: 'string' as const,
          description: 'Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access.',
        },
      } : {},
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: BACKGROUND_OUTPUT_PROPERTIES,
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
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
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'background'
          ? `started background job ${value.jobId}`
          : value.kind === 'frames'
            ? renderFrames(value.frames as ShellFrameRecord[], escalationModes)
            : renderResult(value as ForegroundFrameValue, escalationModes),
      }],
    },
    async execute(args: BashToolArgs, exec) {
      validateBashArgs(args, maxCommandsPerCall)
      // Description is display metadata; workdir defaults to the caller's session.
      const standingPolicy = await resolveSandboxPolicy(exec)
      const approvedMode = args.sandbox_permissions !== undefined && args.justification !== undefined
        ? await approveBashEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy)
        : undefined
      const policy = approvedMode === undefined
        ? standingPolicy
        : { ...(standingPolicy as SandboxExecutionPolicy), mode: approvedMode }
      const dshEnv = ctx.shellEnv.collect(exec)
      if (args.commands === undefined) {
        return executeSingular(args, exec, policy, dshEnv, standingPolicy)
      }
      return executeFrames(args, exec, policy, dshEnv, standingPolicy)
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
          readOutput: () => renderProcessRead(proc.readOutput(), proc.sandbox, escalationModes),
        }
      },
    })
  }

  /** One command per call: the v1 contract, unchanged. */
  async function executeSingular(
    args: BashToolArgs,
    exec: ToolExecution,
    policy: SandboxExecutionPolicy | undefined,
    dshEnv: ReturnType<typeof ctx.shellEnv.collect>,
    standingPolicy: SandboxExecutionPolicy | undefined,
  ) {
    const workdir = resolveWorkdir(args.workdir, exec, standingPolicy?.workspaceRoot)
    const request = {
      command: args.command as string,
      ...workdir !== undefined ? { workdir } : {},
      ...args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {},
      dshEnv,
      ...policy !== undefined ? { sandboxPolicy: policy } : {},
    }
    if (args.run_in_background === true) {
      // Undeclared keys are allowed, so schema omission also needs enforcement.
      if (!backgroundEnabled) {
        throw new Error('run_in_background is disabled for this deployment (enableRunInBackground: false)')
      }
      // The caller owns cancellation until ctx.jobs commits detached ownership.
      if (exec.signal.aborted) {
        const error = new HarnessError('tool call aborted', TOOL_ABORTED)
        error.name = 'AbortError'
        throw error
      }
      const id = startBackgroundJob(exec, args.command as string, request)
      return { kind: 'background' as const, jobId: id }
    }
    const result = await ctx.shell.run(ctx.shell.resolve({
      ...request,
      signal: exec.signal,
    }))
    if (result.aborted) {
      const error = new HarnessError('tool call aborted', TOOL_ABORTED)
      error.name = 'AbortError'
      throw error
    }
    return { kind: 'foreground' as const, ...canonicalBashResult(result) }
  }

  /** Several commands per call: serial element dispatch into labeled frames. */
  async function executeFrames(
    args: BashToolArgs,
    exec: ToolExecution,
    policy: SandboxExecutionPolicy | undefined,
    dshEnv: ReturnType<typeof ctx.shellEnv.collect>,
    standingPolicy: SandboxExecutionPolicy | undefined,
  ): Promise<FramesValue> {
    const baseWorkdir = resolveWorkdir(args.workdir, exec, standingPolicy?.workspaceRoot)
    const elements = args.commands as FramesCommandArgs[]
    const frames: ShellFrameRecord[] = []
    for (const [index, element] of elements.entries()) {
      if (exec.signal.aborted) {
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
        ...policy !== undefined ? { sandboxPolicy: policy } : {},
      }
      if (element.run_in_background === true) {
        if (!backgroundEnabled) {
          throw new Error('run_in_background is disabled for this deployment (enableRunInBackground: false)')
        }
        const id = startBackgroundJob(exec, element.command, request)
        frames.push({ index, command: element.command, outcome: { kind: 'job', jobId: id } })
        continue
      }
      const result = await ctx.shell.run(ctx.shell.resolve({
        ...request,
        signal: exec.signal,
      }))
      if (result.aborted) {
        const error = new HarnessError('tool call aborted', TOOL_ABORTED)
        error.name = 'AbortError'
        throw error
      }
      frames.push({ index, command: element.command, outcome: { kind: 'foreground', ...canonicalBashResult(result) } })
    }
    return { kind: 'frames', frames }
  }
}
/* jscpd:ignore-end */
