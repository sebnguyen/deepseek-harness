/**
 * Model-facing Consumer of the `ctx.shell` capability seam whose registered
 * `bash` tool carries the `commands` batch face as its only call shape: one
 * invocation fans out across independent shell jobs, each settling into its own
 * labeled frame while the wire contract stays one tool call to one tool result.
 * `run_in_background` and the sandbox escalation pair ride single elements, so
 * one element starts as a background job or runs under an approved wider mode
 * without affecting its siblings.
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
import { defineTool, TOOL_ABORTED } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
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
import { renderProcessRead } from '@deepseek-ai/dsh-shell'

export const name = 'tool-bash-frames'
export const inject = ['tools', 'shell', 'systemPrompt', 'shellEnv']

/** Configuration for the frames bash tool. */
export interface Config {
  /** Expose element `run_in_background` (default true); disabled elements are also rejected. */
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
  sandbox_permissions?: string
  justification?: string
}

/** Parsed tool args; execute validates value constraints absent from ParameterSchemaSpec. */
interface BashToolArgs {
  commands?: FramesCommandArgs[]
  description: string
  timeoutMs?: number
  workdir?: string
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
  // The escalation pair moved onto elements with the singular face's removal;
  // a root-level pairing is a stale call shape, not a live override.
  if (args.sandbox_permissions !== undefined || args.justification !== undefined) {
    throw new Error('invalid args: sandbox_permissions and justification apply per commands element')
  }
  if (!Array.isArray(args.commands) || args.commands.length === 0) {
    throw new Error('invalid commands: expected a non-empty array of command objects')
  }
  if (args.commands.length > maxCommandsPerCall) {
    throw new Error(`invalid commands: at most ${maxCommandsPerCall} elements, got ${args.commands.length}`)
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
    // The escalation pairing (sandbox_permissions ⇔ justification, non-empty) is
    // the shared rule both enforcing families validate identically.
    validateEscalationArgs(element.sandbox_permissions, element.justification)
  }
}

function bashDescription(backgroundEnabled: boolean, escalationModes: readonly SandboxMode[]): string {
  const background = backgroundEnabled
    ? 'Set `run_in_background: true` on an element to start it as a background job: its frame carries the job id; read its output with `job_output` and stop it with `job_kill`.'
    : 'Background execution is not available; elements must finish within the timeout.'
  const base = 'Execute bash commands (`bash -c`) and return their stdout/stderr. '
    + 'Pass a `commands` array: elements run in a fresh shell each, in written order, '
    + 'each settles on its own under a `[i/N] $ command` header (its own exit code, '
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
    + 'the exact same command once with `sandbox_permissions` and a one-sentence `justification` on that '
    + 'element (the wider mode applies to that element alone). Do not detour through chat to ask permission '
    + 'first — the approval prompt raised by that retry is how the user consents. If the session states '
    + 'approval prompts are disabled, there is no exception: a denial is final — do not set `sandbox_permissions`. '
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
 * @returns the granted mode, consumed by the one element that asked.
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

/** The frames-only arms of the canonical output union. */
type FramesValue = {
  kind: 'frames'
  frames: { index: number; command: string; outcome: ShellFrameOutcome }[]
}

/**
 * Present a commands call as a generic execute card listing every element while
 * pending; one exit pill cannot represent several elements, so the terminal
 * card stays reserved for single-exit tools.
 */
function presentBashCall(args: BashToolArgs): GenericCallView {
  const elements = Array.isArray(args.commands) ? args.commands : []
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
   * Resolve one element's sandbox-escalation request through `ctx.approval`
   * BEFORE that element executes: composition guard and fail-closed sequence
   * live in {@link requestBashEscalation}; this plugin supplies only the approval
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
      commands: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          // Permissive like the root schema: undeclared element keys reach
          // execute, where the opt-outs (background disabled, escalation
          // pairing) are enforced at dispatch time.
          additionalProperties: true,
          properties: {
            command: { type: 'string', required: true, description: 'The bash command for this element.' },
            description: { type: 'string', description: 'One-line UI label for this element; defaults to the command text.' },
            workdir: { type: 'string', description: 'Working directory override for this element.' },
            timeoutMs: { type: 'number', description: 'Timeout override in milliseconds for this element.' },
            ...backgroundEnabled ? {
              run_in_background: { type: 'boolean' as const, description: 'Run this element in the background; its frame carries the job id.' },
            } : {},
            ...escalationModes.length > 0 ? {
              sandbox_permissions: {
                type: 'string' as const,
                enum: [...escalationModes],
                description: 'The wider sandbox mode this element needs. Only valid as a one-shot retry of a command the sandbox just denied; requires justification and widens this element alone.',
              },
              justification: {
                type: 'string' as const,
                description: 'Required with sandbox_permissions: one sentence for the user explaining why this exact element needs the wider access.',
              },
            } : {},
          },
        },
        description: 'The bash commands to execute, in written order; each element settles into its own labeled frame with its own exit code, timeout, sandbox marker, or background job id, and every element runs even if an earlier one fails.',
      },
      description: {
        type: 'string',
        required: true,
        description: 'Clear, concise description of what this command does in active voice, '
          + '5-10 words (shown in the UI). Examples: "ls" → "List files in current directory"; '
          + '"git status" → "Show working tree status"; "npm install" → "Install package dependencies".',
      },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds for elements without their own. The executor applies its configured default and cap, and kills the element on expiry.' },
      workdir: { type: 'string', description: 'Working directory for elements without their own. Defaults to the session workspace; a relative path is resolved against it.' },
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
        text: renderFrames((value as FramesValue).frames as ShellFrameRecord[], escalationModes),
      }],
    },
    async execute(args: BashToolArgs, exec) {
      validateBashArgs(args, maxCommandsPerCall)
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
          readOutput: () => renderProcessRead(proc.readOutput(), proc.sandbox, escalationModes),
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
    const baseWorkdir = resolveWorkdir(args.workdir, exec, standingPolicy?.workspaceRoot)
    const elements = args.commands as FramesCommandArgs[]
    const frames: ShellFrameRecord[] = []
    for (const [index, element] of elements.entries()) {
      if (exec.signal.aborted) {
        frames.push({ index, command: element.command, outcome: { kind: 'not-run', reason: 'call aborted' } })
        continue
      }
      // An escalated element resolves its one-shot approval before dispatch so
      // widened authority never outlives the single element that asked.
      const approvedMode = element.sandbox_permissions !== undefined && element.justification !== undefined
        ? await approveBashEscalation(element.sandbox_permissions, element.justification, exec, standingPolicy)
        : undefined
      // A cancellation landing during the approval must not detach work the
      // caller stopped asking for.
      if (exec.signal.aborted) {
        if (element.run_in_background === true) {
          const error = new HarnessError('tool call aborted', TOOL_ABORTED)
          error.name = 'AbortError'
          throw error
        }
        frames.push({ index, command: element.command, outcome: { kind: 'not-run', reason: 'call aborted' } })
        continue
      }
      const policy = approvedMode === undefined
        ? standingPolicy
        : { ...(standingPolicy as SandboxExecutionPolicy), mode: approvedMode }
      const workdir = element.workdir !== undefined
        ? resolveWorkdir(element.workdir, exec, standingPolicy?.workspaceRoot)
        : baseWorkdir
      const timeoutMs = element.timeoutMs ?? args.timeoutMs
      const request = {
        command: element.command,
        ...workdir !== undefined ? { workdir } : {},
        ...timeoutMs !== undefined ? { timeoutMs } : {},
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
