# Agent Note: Live skill projection from decision-model judgments

Status: proposed

English | [中文](2026-09-24-decision-model-skill-gating.zh.md)

## Problem

`dsh-tool-skill` publishes every model-invocable skill as one durable catalog and hands the model a `skill` loader tool, so selection is the model's own relevance judgment. That signal fails in both directions: expanding a library from a known-good set to 202 skills cut pass rates by up to 21%, with most of the loss attributed to invoking the wrong skill rather than to the enlarged context ([skill shadowing](https://arxiv.org/html/2605.24050v1)), and models also fail to recognize that a specialized skill is needed at all.

The catalog's own shape compounds the cost. It is latest-wins and append-only, so every change publishes a complete listing whose predecessors stay in the prompt and keep contributing message tokens. The sentence announcing that a catalog "replaces every earlier available-skills list" is an instruction to the model, not an eviction: only compaction removes a superseded node.

Nothing in the harness can therefore admit a skill body because a judgment says the current step needs it, and nothing reports which skill bodies the current window already holds.

## Proposal

The catalog stops being the selection surface. A decision model judges every candidate at every pre-step, and the harness emits the bodies of the skills that judgment admits.

**Decision model.** `@deepseek-ai/dsh-skill-context` holds all three roles: the `ctx.decision` Service Definition, the TypeSafe JeV evaluator answering its questions, and the Consumer that admits skills. One call carries a state and a map of typed questions and returns typed answers with probabilities. The roles stay in one package under the [capability-seam rule](../../implemented/architecture/2026-06-13-capability-seams.md) that a capability with one provider and one Consumer stays one package until a second appears.

**Admission.** At every `agent/pre-step` the gate sends one Noul question per catalog candidate in a single request, and admits the candidates whose probability crosses the configured threshold, capped by top-k.

**Live set.** The gate reads the current window with `Session.deriveMessages()`, the sanctioned derived read: the surface is the single source of derived history, so a compaction `replace` deletes shadowed nodes from the derivation and each surface node is projected once. It collects the names of messages whose source kind is `skill-invocation`. A skill already in that set is never emitted again, so the read is compaction-aware without scanning the event log.

**Emission.** An admitted skill becomes one durable `user/message` carrying the released `skill-invocation` source. No new source kind and no session-format change: that source already carries `kind`, `name`, and `form: 'instructions'`, and the existing readers already render it.

**Cadence.** The judgment runs on every pre-step, and emission happens only when the judgment admits a skill that is not already live. A repeated answer therefore emits nothing, which makes the per-step call safe rather than merely affordable.

**Budget.** Context capacity comes from the resolved model route. A candidate that crosses the threshold while no room remains is counted and surfaced; the window is never extended past capacity and the denial is never silent.

**Retirement.** The catalog publication and the `skill` tool registration are deleted. The `/name` gesture keeps emitting the same source kind through the same path, so user-invoked loading is unchanged.

**Configuration and degradation.** Threshold, top-k, provider, and enablement are validated `Config` fields. A provider failure, an incomplete registry snapshot, or a rejected decision emits nothing and leaves the window exactly as it was.

## What changes per package

- `dsh-skill` keeps the Service Definition and its registry contract; the model-invocable half of the [invocation policy](../../implemented/feature/2026-07-28-skill-invocation-policy.md) stops deciding anything, because no model-facing surface remains for it to gate.
- `dsh-skill-filesystem` and `dsh-skill-badge` are unchanged Service Providers.
- The catalog and loader package becomes a request-context producer and moves to `packages/context/skill-context` as `@deepseek-ai/dsh-skill-context`, since emitting model context is its only remaining role.
- `@deepseek-ai/dsh-skill-context` is new, and is the only package that talks to a decision-model endpoint.

## Implementation plan

Eight slices, each landing with its own focused evidence, none of them requiring a session-format change.

**1. Live-set read.** Add the read as a pure operation over `Session.deriveMessages()`, collecting the `name` of every message whose source kind is `skill-invocation`. The synchronous arbitrary-position readers are deprecated with new calls prohibited, so the read goes through the derived projection rather than resolving event sequences. Nothing consumes it yet. Tests pin a compaction-shadowed node leaving the set, an empty window, and a duplicate injection collapsing to one name.

**2. Decision seam and provider.** Add the `ctx.decision` Service Definition beside its Consumer and its TypeSafe evaluator, following `packages/llm/llm-deepseek` as the provider template: validated `Config` for the endpoint and a pinned model identifier, a bounded call timeout, and typed failures. Unit tests drive a fake evaluator; only the e2e lane calls the endpoint, and it self-skips without a key.

**3. Admission behind a switch.** Register the pre-step listener that consumes the seam and emits one `skill-invocation` message per newly admitted skill, with the catalog listener and the `skill` tool still mounted. Tests pin one message per admission, nothing on an unchanged judgment, and the top-k cap.

**4. Budget and denial.** Read context capacity from the resolved model route and the current composition from `dsh-token-meter`, and count every admission refused for want of room. Tests pin that a refused candidate emits nothing and increments the counter.

**5. Evidence.** Add a keyless session snapshot pinning the emitted message, the compaction-aware no-op on the following step, and a catalog-free transcript; extend the SDK expected outputs if the loop-visible event set changes; and re-run the catalog snapshot to confirm the released generations still replay.

**6. Retirement.** Delete the catalog listener, the render, digest, and history helpers, the `skill` tool definition, and the client `tool.call.toolview` registration for it; move the package to `packages/context/skill-context` as `@deepseek-ai/dsh-skill-context` and update its dependents; update the four composition sites, `packages/bundle/base/cordis.patch.yml`, `packages/bundle/web-app/cordis.patch.yml`, and the standard, cordis, and ptc presets; and rewrite the snapshots that pin the catalog and the tool, `snapshots/web/schedule-catalog`, `snapshots/web/skill-tool-row`, `snapshots/session/skill-load`, and every `tool-schemas.expected.json` listing the `skill` tool.

**7. Policy.** Stop consulting `modelInvocable` where it no longer gates a surface, keep the field and the frontmatter keys, and cross-link the [invocation policy](../../implemented/feature/2026-07-28-skill-invocation-policy.md) rather than deleting it: this is a partial supersession, so both notes stay active and linked.

**8. Docs and gates.** Update the READMEs and JSDoc for the moved package, the new provider, and `dsh-skill`, stating the configuration, the live-set query, the budget-denial counter, and the removed surfaces; then run the affected package tests, `typecheck`, `lint`, `test:docs`, and the affected keyless snapshots.

## Code sketch

The load-bearing types and the listener, at the level slice 1 to slice 4 build against. Signatures follow the shipped service conventions; the capacity read stays an interface until slice 4 binds it.

**The seam.** The Service Definition owns the key and the vocabulary, so no Consumer imports provider types and the provider never sees harness prompt text.

```ts
// packages/context/skill-context/src/decision.ts
import { Service, type Context } from '@deepseek-ai/cordis'

/** One typed question: the judgment to make about the shared state. */
export interface DecisionQuestion {
  readonly id: string
  readonly instructions: string
  /** Answer labels for a Choice question; absent for a Noul question. */
  readonly criteria?: Readonly<Record<string, string>>
}

/** A Noul answer: the probability that the instruction holds, in [0, 1]. */
export interface NoulAnswer {
  readonly kind: 'noul'
  readonly probability: number
}

/** One state evaluated against every question, in a single provider call. */
export interface DecisionRequest {
  readonly state: unknown
  readonly questions: readonly DecisionQuestion[]
}

/** Decision capability: typed questions in, typed answers out. */
export class DecisionService extends Service {
  /**
   * @param ctx - plugin context owning the `decision` key.
   */
  constructor(ctx: Context) {
    super(ctx, 'decision')
  }

  /**
   * Evaluate every question against one state.
   * @param request - the state and the questions to answer.
   * @param signal - aborts the provider call.
   * @returns one answer per question, in request order.
   */
  async evaluate(request: DecisionRequest, signal: AbortSignal): Promise<readonly NoulAnswer[]> {
    void request; void signal
    throw new Error('dsh-decision: no evaluator is registered')
  }
}
```

**The provider.** Every deployment-varying choice is a validated `Config` field, and the model identifier is pinned rather than aliased so a version move cannot silently retune a threshold.

```ts
// packages/context/skill-context/src/typesafe.ts
export interface Config {
  /** Pinned model identifier; an alias would reprice and retune without notice. */
  model: string
  /** Evaluation endpoint. */
  endpoint?: string
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  model: z.string().required(),
  endpoint: z.string().default('https://api.typesafe.ai/v1/systemone'),
  timeoutMs: z.number().default(10_000),
})

/** Noul questions are renormalized probabilities, so the id is never sent to the model. */
function toBody(request: DecisionRequest): unknown {
  return {
    model: config.model,
    state: request.state,
    questions: Object.fromEntries(
      request.questions.map(question => [question.id, { type: 'noul', instructions: question.instructions }]),
    ),
  }
}
```

**The live set.** The session is the source of truth, and the derived window is where it is read: a compaction `replace` deletes shadowed nodes from the derivation, so the read needs no cache and no event-log scan.

```ts
// packages/context/skill-context/src/live-set.ts
import type { Session } from '@deepseek-ai/dsh-session'

/**
 * Skill names whose bodies are currently in the model's window.
 * The derived-message projection is the sanctioned window read: the surface is
 * the single source of derived history, so a compaction replace deletes shadowed nodes.
 * @param session - the calling agent's session.
 * @returns names of live `skill-invocation` injections.
 */
export function liveSkillNames(session: Session): Set<string> {
  const live = new Set<string>()
  for (const message of session.deriveMessages()) {
    if (message.source.kind !== 'skill-invocation') continue
    live.add(message.source.name)
  }
  return live
}
```

**The listener.** One judgment per step, add-only emission, and an unchanged judgment emits nothing, so the per-step call is idempotent rather than merely affordable.

```ts
// packages/context/skill-context/src/index.ts
export const name = 'skill-context'
export const inject = ['agents', 'skills', 'decision']

ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
  const decision = await next()
  if (decision.kind === 'reject') return decision
  const snapshot = await ctx.skills.snapshot({ cwd: agent.session.header.cwd, signal, scope: agent })
  if (!snapshot.complete) return decision
  const live = liveSkillNames(agent.session)
  const pending = snapshot.skills.filter(skill => isModelInvocable(skill) && !live.has(skill.name))
  if (pending.length === 0) return decision
  let answers: readonly NoulAnswer[]
  try {
    answers = await ctx.decision.evaluate({
      state: { task: taskText(agent.session), workspace: { cwd: agent.session.header.cwd } },
      questions: pending.map(skill => ({
        id: skill.name,
        instructions: `Is this skill needed to complete the task? ${skill.description}`,
      })),
    }, signal)
  } catch (error: unknown) {
    ctx.logger.warn(`skill-context: judgment failed, window unchanged: ${String(error)}`)
    return decision
  }
  signal.throwIfAborted()
  const admitted = pending
    .filter((_, index) => (answers[index]?.probability ?? 0) > config.threshold)
    .slice(0, config.topK)
  return { ...decision, messages: [...decision.messages, ...admitted.map(skillMessage)] }
})
```

**The capacity read.** Context capacity belongs to the resolved route, so it enters as a capability rather than a constant; slice 4 binds the resolved model's context window and `ctx.tokenMeter` to it, and a candidate admitted with no remaining room is counted rather than emitted.

```ts
/** Remaining tokens this step may spend on injected skill bodies. */
interface SkillBudget {
  /**
   * @param agent - the agent whose route supplies capacity.
   * @returns tokens still available, or undefined when capacity is unknown.
   */
  remaining(agent: Agent): Promise<number | undefined>
}
```

## Alternatives considered

**Rewrite the catalog message instead of emitting bodies.** Rejected. Latest-wins semantics make any change a full listing, the replaced node costs a cache re-prefill at its position, and the design would need per-slot liveness to know which node to shadow. Emitting one body per admitted skill appends, needs no removal, and bounds the working set at one body per distinct skill ever admitted.

**Keep the `skill` loader tool.** Rejected because it leaves selection with the signal that measurably fails, and because a decision model that only advises while the model still decides cannot demonstrate its own effect. The cost is recorded under Risks: the model loses its recovery path.

**Take a second service key alongside `ctx.skills`.** Rejected: one Cordis key has one owner, a second registry would need its own providers and lookups, and existing sessions would have no migration path between them.

**Cache the live set in a `WeakMap` invalidated by `session/event`.** Rejected in favor of reading `Session.deriveMessages()` on each judgment. That projection is already the authoritative derived window and is maintained per surface node, so a cache would be a second derived copy to reconcile against forks, resumes, and foreign replacements.

**One Choice question over the whole catalog.** Rejected because option-label ordering affects the answer and accuracy degrades with the number of options; per-candidate Noul questions keep every judgment binary.

**A version-named successor package.** Rejected on the [package naming rule](../../../../docs/cookbook/adding-a-package.md): a suffix names a version rather than a role, and this repository's public plugin APIs are pre-stable, so the contract changes in place.

## Acceptance criteria

- A live-set test proves that an emitted skill is not emitted twice, and that a node shadowed by compaction leaves the live set and becomes emittable again.
- A test proves that an unchanged judgment emits nothing on the following pre-step, and that an admitted skill outside the live set emits exactly one `skill-invocation` message.
- A test proves that a candidate above threshold with no remaining capacity is counted and surfaced, and that no message is emitted for it.
- A test proves that a provider failure, an incomplete snapshot, and a rejected decision each leave the session message set unchanged.
- A keyless snapshotted session replays a catalog-free transcript and reconstructs the live set from the derived window alone, with no decision-model call on replay.
- Package READMEs and JSDoc state the configuration, the budget-denial behavior, the live-set query, and the removed model-facing surfaces.

## Risks

Removing the loader tool makes the gate the only path by which a model obtains a skill body. A wrong judgment is then an unrecoverable capability loss rather than a suboptimal hint, which is the strongest argument for keeping the threshold conservative and the deny path observable.

The window only grows. Every emitted body stays until compaction shadows it, so remaining capacity is monotonically non-increasing and a skill denied for want of room stays denied unless automatic compaction reclaims space. The design therefore depends on auto-compaction being enabled, and that dependency must be stated rather than assumed.

The judgment reads relevance unless it is given outcome evidence, and relevance is the signal that already fails. Without paired with/without runs the gate can reduce tokens and still miss the same skills the model misses.

The provider is in early access, publishes no cache contract, and moves its alias between versions, so a threshold tuned against one version must pin the versioned identifier.
