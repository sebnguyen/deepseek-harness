/**
 * Opt-in speculative prefetch: sealed reasoning blocks are scanned for file
 * and directory mentions, grounded through the fs seam against the session
 * workspace, and staged content rides the next step's pre-step decision so
 * the reads the reasoning already decided cost no round trip.
 *
 * @module @deepseek-ai/dsh-experimental-reasoning-prefetch
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { extractCandidates } from './extract.ts'
import { stageCandidates, type PrefetchedEntry, type StageBudget } from './stage.ts'

/** Cordis plugin name used for loader diagnostics and message provenance. */
export const name = 'reasoning-prefetch'

/** The agent registry owns stream observation; fs stays optional. */
export const inject = ['agents']

/** Request-preparation prefetch tuning. Invalid values fail plugin load. */
export interface Config {
  /** Maximum content reads staged per attempt (default 4). */
  maxFiles?: number
  /** Per-read byte ceiling; oversized files are skipped, not truncated. */
  maxFileBytes?: number
  /** Aggregate injected-byte ceiling per attempt (default 65536). */
  maxTotalBytes?: number
  /** Milliseconds a step's pre-step waits for in-flight staging (default 50). */
  prefetchWaitMs?: number
  /** Directory-listing line ceiling (default 40). */
  listLines?: number
  /** Accepted for compatibility; v1 stages at attempt end for both values. */
  parsePoint?: 'attempt-end' | 'pre-step'
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  maxFiles: z.number().step(1).min(1).default(4),
  maxFileBytes: z.number().step(1).min(1).default(16_384),
  maxTotalBytes: z.number().step(1).min(64).default(65_536),
  prefetchWaitMs: z.number().min(0).default(50),
  listLines: z.number().step(1).min(1).default(40),
  parsePoint: z.union(['attempt-end', 'pre-step']).default('attempt-end'),
})

/**
 * Resolve one staging spec from partial config: the explicit defaulting step
 * loaders may skip, so direct `apply()` callers behave identically.
 * @param config - possibly partial configuration.
 * @returns the stage budget plus the pre-step wait window.
 */
export function resolveBudgets(config: Config): { budget: StageBudget; waitMs: number } {
  return {
    budget: {
      maxFiles: config.maxFiles ?? 4,
      maxFileBytes: config.maxFileBytes ?? 16_384,
      maxTotalBytes: config.maxTotalBytes ?? 65_536,
      listLines: config.listLines ?? 40,
    },
    waitMs: config.prefetchWaitMs ?? 50,
  }
}

/** One attempt's accumulated live stream, sealed at its terminal frame. */
export interface AttemptAccumulator {
  /** The agent the attempt belongs to. */
  agent: Agent
  /** Reasoning block text per block index. */
  reasoning: Map<number, string>
  /** Visible response text, empty while the attempt only thinks or calls tools. */
  responseText: string
  /** Tool-call argument text, scanned for the attempt's own read paths. */
  callArguments: string[]
}

/** Staged entries plus the promise the pre-step may race. */
interface PendingBatch {
  ready: Promise<PrefetchedEntry[]>
}

/**
 * Register observation, staging, and injection for the lifetime of `ctx`.
 * @param ctx - plugin context; listeners are disposed with it.
 * @param config - validated budgets and knobs.
 */
export function apply(ctx: Context, config: Config): void {
  const { budget, waitMs } = resolveBudgets(config)
  const attempts = new Map<string, AttemptAccumulator>()
  const pending = new Map<Agent, PendingBatch[]>()

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    handleFrame(attempts, pending, ctx, agent, frame, budget)
  })

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    /* v8 ignore next 2 -- a rejected step carries no request to enrich */
    if (decision.kind === 'reject') return decision
    const batch = pending.get(agent)
    if (batch === undefined) return decision
    pending.delete(agent)
    const entries: PrefetchedEntry[] = []
    for (const item of batch) {
      entries.push(...await raceReady(item, waitMs))
    }
    if (entries.length === 0) return decision
    return { ...decision, messages: [...decision.messages, renderInjection(entries)] }
  })

  ctx.effect(() => () => {
    attempts.clear()
    pending.clear()
  }, 'reasoning-prefetch: attempt state')
}

/** Fold one live frame; seal and stage at the terminal frame. */
function handleFrame(
  attempts: Map<string, AttemptAccumulator>,
  pending: Map<Agent, PendingBatch[]>,
  ctx: Context,
  agent: Agent,
  frame: AssistantStreamFrame,
  budget: StageBudget,
): void {
  if (frame.type === 'start') {
    attempts.set(frame.attemptId, { agent, reasoning: new Map(), responseText: '', callArguments: [] })
    return
  }
  const attempt = attempts.get(frame.attemptId)
  /* v8 ignore next 2 -- frames only arrive for attempts this listener started */
  if (attempt === undefined) return
  if (frame.type === 'chunk') {
    foldChunk(attempt, frame.chunk)
    return
  }
  attempts.delete(frame.attemptId)
  sealAndStage(pending, ctx, attempt, budget)
}

/** Accumulate one live chunk into its block accumulators. */
function foldChunk(attempt: AttemptAccumulator, chunk: StreamChunk): void {
  if (chunk.type === 'reasoning-delta') {
    attempt.reasoning.set(chunk.index, `${attempt.reasoning.get(chunk.index) ?? ''}${chunk.text}`)
    return
  }
  if (chunk.type === 'text-delta') {
    attempt.responseText += chunk.text
    return
  }
  if (chunk.type === 'tool-call-delta') {
    attempt.callArguments.push(chunk.argumentsDelta)
  }
}

/** Parse the sealed reasoning, drop same-attempt paths, and stage survivors. */
function sealAndStage(
  pending: Map<Agent, PendingBatch[]>,
  ctx: Context,
  attempt: AttemptAccumulator,
  budget: StageBudget,
): void {
  const reasoning = [...attempt.reasoning.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, text]) => text)
    .join('\n')
  if (reasoning.trim() === '') return
  // A visible response that does not end at a sentence terminus is a mid-thought
  // utterance: the model will continue the attempt over the text it already
  // holds, so staging at that step only spends injection budget.
  const tail = attempt.responseText.trim()
  const terminal = tail === '' || tail.endsWith('.')
  if (!terminal) return
  // Tool-call arguments arrive as JSON; unquote so quoted paths feed the span layer.
  const called = new Set(
    attempt.callArguments
      .map(text => text.replaceAll('"', ' '))
      .flatMap(text => extractCandidates(text))
      .map(candidate => candidate.span),
  )
  const prospects = extractCandidates(reasoning)
    .filter(candidate => !called.has(candidate.span))
  pending.set(attempt.agent, [
    ...pending.get(attempt.agent) ?? [],
    { ready: stageCandidates(ctx, attempt.agent, budget, prospects, new AbortController().signal) },
  ])
}

/** Await staging within the step's bound; a staging failure stages nothing. */
async function raceReady(batch: PendingBatch, waitMs: number): Promise<PrefetchedEntry[]> {
  const timeout = new Promise<PrefetchedEntry[]>((resolve) => {
    // v8 ignore next -- the wall-clock race loses to settled staging under tests
    setTimeout(() => { resolve([]) }, waitMs)
  })
  // v8 ignore next -- ready rejects only for staging bugs the caller treats as empty
  return Promise.race([batch.ready.catch(() => []), timeout])
}

/** One durable user message carrying the staged prospects. */
function renderInjection(entries: PrefetchedEntry[]): UserMessage {
  const lines: string[] = [
    'Harness detected these potential reads in your reasoning stream; staged just now:',
  ]
  for (const entry of entries) {
    lines.push('', `### ${entry.path} (${entry.kind}, ${entry.bytes} bytes)`)
    lines.push(entry.text === '' ? '(empty)' : entry.text)
  }
  lines.push('', 'Content is fresh as of the observed time. Use it directly; call read only if something later must be newer.')
  const text = lines.join('\n')
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
  })
}
