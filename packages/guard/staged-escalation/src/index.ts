/**
 * Per-turn staged escalation: an explore-then-act gate that denies act-stage
 * tools (never hides them, keeping the tool catalog and prompt cache clean)
 * until the turn logs successful lower-stage activity, clamps the sandbox
 * fence narrow-only while locked, and offers `request_escalation` as the
 * affirmative crossing. The current stage is a pure fold of this turn's
 * session log, so every user message re-arms the ladder and a resumed session
 * re-derives it with no hidden state.
 *
 * The step-1 reminder and promotion replies render each stage's configured
 * `description` verbatim under a `You are in the "<name>" stage.` header, so
 * the encouragement lives in deployment config while these pinned strings —
 * the reminder skeleton, the one-line denial, the escalation replies, and the
 * Core Rule section — live here.
 *
 * @module @deepseek-ai/dsh-staged-escalation
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage, type ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import '@deepseek-ai/dsh-sandbox-policy'
import type { Session } from '@deepseek-ai/dsh-session'
import '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-user-approval'

/** One rung of the escalation ladder; the array index is the tier. */
export interface Stage {
  /** Tool names admitted at this tier; `'*'` alone on the last stage admits all. */
  allow: string[]
  /** The widest sandbox fence this tier may run under (clamped narrow-only). */
  sandbox: SandboxMode
  /** Marker vocabulary every rendering carries. */
  name: string
  /** Rationale-led encouragement paragraph, injected verbatim by the reminder. */
  description: string
}

/** Plugin config: the stage ladder and the reminder switch. */
export interface Config {
  /** The ladder; index is tier, stage 0 hosts the probes and reads. */
  stages?: Stage[]
  /** Inject the step-1 reminder on locked turns (default true). */
  turnStartReminder?: boolean
}

const DEFAULT_DESCRIPTIONS = {
  explore: "Exploration can be expedited and parallelized: the explore tool launches subagents that run on faster, cheaper models and search the workspace for you, returning a token-efficient curated output instead of the raw firehose. Thoroughly exploring before you act is effort well spent here — a turn that chases a non-viable solution built on unverified premises costs far more than the exploration that would have surfaced it, and read, grep, and glob pin down exactly which files the change touches, web_search fetches what the repo doesn't keep, and ask_user_question turns ambiguous requests into specifications. Example: one explore call mapping how auth flows before writing the refactor saves three writes that each re-discover part of it; one ask_user_question about an ambiguous number beats a guessed file. You can use request_escalation with the stage and a justification when you are ready to move on to the next stage after exploring, or where the evidence genuinely cannot precede the action.",
  act: 'The act stage is where confidence gets spent: create, modify, execute, and reach the network — act on what exploration pinned down, on premises now read, searched, and answered rather than guessed. Stages last this turn only; your next message re-arms explore.',
}

/** Ordinal width of the three sandbox modes, for the narrow-only clamp. */
const MODE_RANK: Record<SandboxMode, number> = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }

/** Schemastery validation for {@link Config}; the shipped default ladder is explore then act. */
export const Config: z<Config> = z.object({
  stages: z.array(z.object({
    allow: z.array(z.string()),
    sandbox: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const),
    name: z.string(),
    description: z.string(),
  })).default([
    {
      name: 'explore',
      description: DEFAULT_DESCRIPTIONS.explore,
      allow: ['ask_user_question', 'read', 'read_image', 'read_note', 'grep', 'glob', 'lsp', 'explore', 'subagent', 'web_search', 'web_fetch'],
      sandbox: 'read-only',
    },
    {
      name: 'act',
      description: DEFAULT_DESCRIPTIONS.act,
      allow: ['*'],
      sandbox: 'workspace-write',
    },
  ]),
  turnStartReminder: z.boolean().default(true),
})

export const CORE_RULE = "Core Rule: Explore Before You Act - A guess about the workspace is cheap to verify and expensive to act on: the unknowns a turn ignores do not vanish, they only move into failed runs, overwritten files, and replies the user must correct, while a read or a question settles them at the price of tokens. The deployment therefore names two phases in every turn, explore then act: explorer subagents bring broad ground truth in one round trip, reads, grep, and glob pin the exact files a change will touch, searches fetch what the repository does not hold, and ask_user_question turns an ambiguous request into a specification — so the writing and running that follow carry confidence instead of guesses. An act call the turn's evidence does not yet justify returns a single-line staged Error naming the explore moves that would justify it, a detour of one step, and request_escalation crosses the border with its stage and reason when evidence genuinely cannot precede the act; the question re-arms with each user message, because each new task brings its own unverified premises. Example: an ambiguous numeric asks one ask_user_question rather than receiving one invented file, and the first write of a file the turn just read is the shape of an act phase that cost nothing to earn."

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** The step-1 staging reminder on a locked turn. */
    'staged-escalation': StagedEscalationSource
  }
}

/** Source tag of the injected reminder message. */
export interface StagedEscalationSource {
  kind: 'staged-escalation'
  /** The stage the turn sat in when the reminder rendered. */
  currentStage: string
}

/**
 * The one-line refusal the pre-execute gate renders (the runtime prefixes
 * `Error: `), pinned so the denial stays short and points at the lever.
 * @param stageName - the stage the turn currently sits in.
 * @returns the marker-styled denial text.
 */
export function denyReason(stageName: string): string {
  return `[staging] This tool is blocked due to your "${stageName}" stage — trigger request_escalation when you are ready to proceed to the next stage.`
}

/**
 * The promotion reply `request_escalation` returns and logs on a grant; the
 * fold recognizes a promotion by its header line.
 * @param stage - the granted stage whose description rides verbatim.
 * @returns the grant text.
 */
export function grantText(stage: Stage): string {
  return `[staging] You are in the "${stage.name}" stage.\n\n${stage.description}\nThis promotion lasts this turn only.`
}

/**
 * The refusal `request_escalation` throws when no answerer granted the stage.
 * @param stageName - the requested stage.
 * @returns the decline text.
 */
export function declineText(stageName: string): string {
  return `[staging: escalation to "${stageName}" declined — the turn shows no explore evidence, the mechanical answerer declined, and no judge or human answerer overrode.]`
}

/**
 * Render the step-1 reminder: header, the current stage's `description`
 * verbatim, the locked next stage, and one mechanics line.
 * @param current - the stage the turn sits in.
 * @param locked - the next stage, still locked.
 * @returns the reminder body.
 */
export function reminderText(current: Stage, locked: Stage): string {
  return `[staging] You are in the "${current.name}" stage.\n\n${current.description}\n\nLocked next: "${locked.name}" — ${locked.description}\nUntil this turn records one "${current.name}" move, later-stage tools return a staged Error instead of executing and the file and shell fences hold at ${current.sandbox}; the stages restart with each user message.`
}

/**
 * The tier a tool belongs to: the first stage whose `allow` lists it, with a
 * lone `'*'` on the last stage admitting every unlisted and future tool.
 * @param stages - the validated ladder.
 * @param tool - the called tool's name.
 * @returns the tool's tier index.
 */
export function stageOfTool(stages: readonly Stage[], tool: string): number {
  const listed = stages.findIndex(stage => stage.allow.includes(tool))
  if (listed >= 0) return listed
  return stages.length - 1
}

const GRANT_HEADER = /^\[staging\] You are in the "([^"]+)" stage\./

/** The reason line `approveEscalation` stamps onto bash escalation requests. */
const BASH_ESCALATION_MODE = /^escalate sandbox to (read-only|workspace-write|danger-full-access):/

/**
 * The current stage as a pure fold of the session log since the last
 * `turn/start`: any successful turn-local call lifts the turn one tier above
 * that call's own tier, and a logged `request_escalation` grant lifts it to
 * the granted tier.
 * @param stages - the validated ladder.
 * @param session - the calling session to fold.
 * @returns the tier index the turn currently sits in.
 */
export function currentStage(stages: readonly Stage[], session: Session): number {
  let current = 0
  const pending = new Map<ToolCallId, string>()
  // A resumed session must re-derive its stage from the persisted log;
  // live call-time observation cannot replay events that predate it.
  // oxlint-disable-next-line typescript/no-deprecated -- deliberate synchronous log replay.
  for (const event of session.snapshotEvents()) {
    if (event.type === 'turn/start') {
      current = 0
      pending.clear()
      continue
    }
    if (event.type === 'tool/call') {
      pending.set(event.data.callId, event.data.name)
      continue
    }
    if (event.type !== 'tool/result') continue
    const block = event.data.message.content[0]
    const name = pending.get(block.toolCallId)
    pending.delete(block.toolCallId)
    if (name === undefined || block.isError === true) continue
    if (name === 'request_escalation') {
      const text = block.content.find(part => part.type === 'text')
      const granted = text?.type === 'text' ? GRANT_HEADER.exec(text.text)?.[1] : undefined
      const tier = granted === undefined ? -1 : stages.findIndex(stage => stage.name === granted)
      if (tier > current) current = tier
      continue
    }
    const tier = stageOfTool(stages, name)
    if (tier >= 0 && tier + 1 > current) current = Math.min(stages.length - 1, tier + 1)
  }
  return current
}

/**
 * Fail loud at load on a ladder the fold cannot state: an empty ladder, an
 * empty or duplicated name, an empty description, an empty stage, or a `'*'`
 * anywhere but alone on the last stage.
 * @param stages - the configured ladder.
 */
function validate(stages: readonly Stage[]): void {
  if (stages.length === 0) throw new Error('staged-escalation: the ladder needs at least one stage')
  const names = new Set<string>()
  stages.forEach((stage, index) => {
    if (stage.name.length === 0) throw new Error('staged-escalation: a stage name must not be empty')
    if (names.has(stage.name)) throw new Error(`staged-escalation: duplicated stage name "${stage.name}"`)
    names.add(stage.name)
    if (stage.description.length === 0) throw new Error(`staged-escalation: stage "${stage.name}" needs a description`)
    if (stage.allow.length === 0) throw new Error(`staged-escalation: stage "${stage.name}" admits no tool`)
    if (stage.allow.includes('*') && (index !== stages.length - 1 || stage.allow.length !== 1)) {
      throw new Error(`staged-escalation: '*' must sit alone on the last stage, not in "${stage.name}"`)
    }
  })
}

/** Cordis plugin name used for loader diagnostics. */
export const name = 'staged-escalation'
/** The gate rides the tool surface and the static prompt section. */
export const inject = ['tools', 'systemPrompt']

/**
 * Compose the gate: the pre-execute denial, the step-1 reminder, the
 * narrow-only sandbox clamp, the `request_escalation` tool with its
 * mechanical approval answerer, and the static Core Rule section.
 * @param ctx - the cordis context.
 * @param config - the stage ladder and reminder switch.
 */
export function apply(ctx: Context, config: Config): void {
  const stages = config.stages ?? []
  validate(stages)
  /** The fold's tier is clamped to the ladder by construction, so every index below is in range. */
  const stageAt = (tier: number): Stage => stages[tier] as Stage

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.agent === undefined) return next()
    const current = currentStage(stages, exec.agent.session)
    if (stageOfTool(stages, exec.name) <= current) return next()
    return { kind: 'deny', reason: denyReason(stageAt(current).name) }
  })

  if (config.turnStartReminder !== false) {
    ctx.on('agent/pre-step', async ({ agent, step }, next) => {
      const decision = await next()
      if (decision.kind !== 'enter' || step !== 1) return decision
      const current = currentStage(stages, agent.session)
      if (current >= stages.length - 1) return decision
      const source: StagedEscalationSource = { kind: 'staged-escalation', currentStage: stageAt(current).name }
      const reminder: UserMessage = createUserMessage({
        content: [{ type: 'text', text: reminderText(stageAt(current), stageAt(current + 1)) }],
        source,
      })
      return { ...decision, messages: [...decision.messages, reminder] }
    })
  }

  ctx.on('sandbox-policy/resolve', async (_standing, session, next) => {
    const resolved = await next()
    if (session === undefined) return resolved
    const stageMode = stageAt(currentStage(stages, session)).sandbox
    return MODE_RANK[stageMode] < MODE_RANK[resolved.mode] ? { ...resolved, mode: stageMode } : resolved
  })

  const pendingEscalations = new Map<ToolCallId, number>()
  ctx.on('approval/request', async (req, next) => {
    const callId = req.callId
    if (callId !== undefined) {
      const pending = pendingEscalations.get(callId)
      if (pending !== undefined) {
        pendingEscalations.delete(callId)
        return currentStage(stages, req.agent.session) >= pending ? 'allowed-once' : next()
      }
    }
    // Mechanical answerer for the shared `sandbox_permissions` path: a
    // pre-evidence bash escalation is allowed-once exactly when the turn's
    // fold already sits at a stage whose sandbox admits the requested mode.
    const mode = BASH_ESCALATION_MODE.exec(req.reason ?? '')?.[1] as SandboxMode | undefined
    if (mode === undefined) return next()
    const stageMode = stageAt(currentStage(stages, req.agent.session)).sandbox
    return MODE_RANK[stageMode] >= MODE_RANK[mode] ? 'allowed-once' : next()
  })

  ctx.tools.register(defineTool({
    name: 'request_escalation',
    description: 'Cross to a later stage of this turn\'s staged escalation with a justification, when evidence genuinely cannot precede the act.',
    parameters: {
      stage: { type: 'string', required: true, enum: stages.map(stage => stage.name), description: 'The stage to proceed to.' },
      justification: { type: 'string', required: true, description: 'Why the act cannot wait for explore evidence this turn.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('request_escalation requires an owning agent session')
      const requested = stages.findIndex(stage => stage.name === args.stage)
      if (requested < 0) throw new Error(`request_escalation: unknown stage "${args.stage}"`)
      const current = currentStage(stages, exec.agent.session)
      if (current >= requested) {
        return { text: `Already at or past "${args.stage}" this turn.` }
      }
      const approver = ctx.get('approval')
      if (approver === undefined) throw new Error(declineText(args.stage))
      pendingEscalations.set(exec.callId, requested)
      const outcome = await approver.request({
        agent: exec.agent,
        toolName: 'request_escalation',
        callId: exec.callId,
        reason: `escalate to "${args.stage}": ${args.justification}`,
      })
      pendingEscalations.delete(exec.callId)
      if (outcome !== 'allowed-once') throw new Error(declineText(args.stage))
      return { text: grantText(stages[requested] as Stage) }
    },
  }))

  ctx.systemPrompt.section({ name: 'staging:core-rule', order: 141, text: CORE_RULE })
}
