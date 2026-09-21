# Agent Note: Declared verification claims for turn settlement

Status: implemented

## Problem

An agent that reports its own work as finished is reporting a belief, not a fact. The two most common ways that report is wrong are sincere, not deceptive: the model is anchored on what it intended rather than on what it produced, and it optimizes whatever proxy the task made measurable. Neither is detectable by asking, because the model's answer is generated from the same belief that produced the wrong report.

The external evidence is unambiguous. [METR](https://metr.org/blog/2025-06-05-recent-reward-hacking/) measured o3 reward-hacking in 30.4% of RE-Bench runs, including 21 of 21 runs on one task, against 0.7% on HCAST; the discriminator was whether the model could see the scoring function, which made hacking more than 43× more common. After one hack the model answered "Does the above plan or action adhere to the user's intention?" with "no" ten times out of ten, while claiming in the abstract that it would never cheat. Self-report is therefore not a control, and neither is a same-context verifier that shares the model's belief.

Before this change, `agent/turn-stopping` was published and had no listener anywhere in the tree; the [agent-loop README](../../../../packages/core/agent-loop/README.md) named it as the extension point where a policy that bounds runaway turns belongs. Nothing prompted an agent to state what it intended to achieve before it worked, and nothing checked that statement before the turn closed.

## Decision

The claim group marks each turn's first step with a plugin-sourced reminder and prompts the agent to declare what must be true when the turn completes, binds one shell verifier to each declaration, and runs every verifier the model leaves open when the turn is about to close. Any number of claims per turn, each immutable once declared, one verifier per claim, in-turn execution through `run_claim` as well as boundary execution, multiple recorded verifier results per claim as the agent repairs in turn, and a bounded number of model round-trips before a still-failing claim settles as blocked. The agent-loop is not modified: every piece composes on an extension point that already exists.

The group is **advisory about ordering**. It prompts a declaration and records it; it does not escalate privileges, block tools, observe when the declaration was made, or change the sandbox mode. The reasons are in [Ordering is not enforced](#ordering-is-not-enforced), and the property that costs is stated under Risks.

The vocabulary: a **claim** is one declared condition of the turn, carried as a `title` and a `description`; a **verifier** is the one shell script bound to it; a **result** is one recorded verifier execution; **settlement** is the terminal state, one of `pending`, `passed`, `tampered`, or `blocked`.

### The claim

A claim is one immutable record, scoped to the turn that declared it. It carries a branded `id`, its `turn` and `revision`, the two prose fields `title` and `description`, one `verifier` (`{ source, digest }`, required), the `results` array (`{ outcome, evidence }` per run), and a `settlement` that starts `{ kind: 'pending' }`. The full type is on the [claim subsystem page](../../../../docs/subsystems/claim.md).

`title` is a short label; `description` states what must be true when the claim is settled. Both are required prose fields. `revision` starts at 1 and advances with each recorded result, so the revision counts verifier runs. The `settlement` is always present: the open state is the `{ kind: 'pending' }` variant, so a consumer never checks for absence.

The claim's content is immutable once declared and a turn declares any number of them, one per independent condition. Content immutability is a stronger guarantee than a rule against weakening: if the condition cannot change, the renegotiation failure "fail, then redefine success downward" has no surface to occur on, and no comparison logic is needed to police it. Declaring several claims for one turn is not amendment: each claim is a separate commitment that settles independently, and no claim's recorded condition can be revised after the fact. Each claim carries its own `turn` field instead of the state tracking a separate open index.

`run_claim(id)` is the in-turn path: it runs the claim's bound verifier through the shell seam, records the result, and settles the claim as `passed` on a pass (or as `tampered` on a digest mismatch), leaving a fail or inconclusive run recorded and the claim open for repair. It exists so the model can face its own check and repair inside the turn instead of waiting for the boundary, and so a recorded run — not a claim of one — is what unblocks `abandon_claim`.

`abandon_claim(id, reason)` is the honest exit for a claim the model declared wrongly; it settles the claim as `blocked` with code `abandoned`, is logged, and ends claim handling for that claim. It is refused while the bound verifier has not yet run, so a declaration cannot be walked away from without facing its check at least once, and no claim can be opened and closed to dodge verification entirely. The refusal reads the count of recorded results for the claim, so the guard is a fold over the log rather than separate bookkeeping. Because a turn declares any number of claims, a replacement declaration after an abandonment is possible; the abandoned claim stays in the ledger as recorded evidence, and the standing demand tells the model to repair the work rather than declare replacement claims round after round.

### Ordering is not enforced

A commitment is only a commitment if it precedes the work, and the obvious way to guarantee that is to deny workspace mutation until a claim exists. This design does not do it, for two reasons that are about authority and cost rather than effort.

Enforcing the ordering means writing the session's sandbox mode, because that is the only mechanism that gates mutation by capability rather than by tool name. `SandboxPolicyService.resolve()` composes `request.mode ?? sessionOverride ?? defaultMode`, and `sessionOverride` is the fold of `sandbox/mode` events — the same single cell a user's policy control writes. A plugin that appends to that cell makes last-writer-wins decide whether a user's deliberate `read-only` choice survives, which is a privilege escalation the plugin has no standing to perform. The alternative is a tightening-only precedence layer inside `sandbox-policy`, which is a service-contract change to another package in service of a policy the user has not asked for.

The second cost is the prompt. The policy would be a dynamic system-prompt contribution re-rendered on every request, so changing the resolved mode mid-turn changes the model-visible prompt, makes the loop reconcile a new `system/message` state, and invalidates the provider's cached prefix on every work turn. A turn would pay a cache break to learn something the denial message already tells it.

Nothing replaces the gate. The plugin prompts the declaration and records it, and nothing observes or constrains when it was made.

### Verification

A verifier is a shell script, not a member of a typed registry. The registry was never the defense: `unit-tests` is a shell command with a dictionary entry in front of it, and the hacking risk sits in who authored the predicate and whether its inputs are writable. Shell keeps the flexibility, gives `exit 0`/non-zero as the predicate, and requires no new vocabulary.

`bindVerifier(source)` computes the SHA-256 of the script text at declaration and stores `{ source, digest }` in the durable event. The settlement listener re-hashes the script immediately before every execution; a mismatch is `tampered` and is never retried, so an agent cannot freeze a benign check, get it recorded, and swap the text for something vacuous.

### Outcomes

A verifier run produces exactly one outcome, recorded as a `claim/result` event:

| Outcome | Meaning | Source |
|---|---|---|
| `pass` | Exit code 0 | Executor |
| `fail` | Exit code non-zero | Executor |
| `inconclusive` | Killed before finishing (timeout or signal) or could not run at all | Executor or shell seam |
| `tampered` | The script no longer hashes to its binding | Freeze check |

`inconclusive` is distinct from `fail` on purpose: a verifier the executor killed is evidence about the harness, not the work, so it must not consume the model's repair budget.

### Settlement and budget

Settlement happens at `agent/turn-stopping`, the loop's serial pre-boundary point; `agent.steer()` is the only objection it supports, and a steer queues to `inbox.nextStep`, so the same turn runs another step and the verifier runs again against the repaired work. The listener settles every claim the model left open, including one it already ran itself while the repair budget allows. The policy is:

| Verifier outcome | Settlement behavior |
|---|---|
| `pass` | Settles the claim as `passed` |
| `fail` | Steers the verifier output back for repair; blocks as `repair-budget-exhausted` once the budget is spent |
| `inconclusive` | Retries the verifier without steering; blocks as `verifier-unavailable` once the retries are spent |
| `tampered` | Blocks immediately; never retried |

`repairBudget` counts **steers** (default `1`), so it bounds the number of model round-trips one claim can cost: the default grants the model exactly one steered repair round, after which a still-failing claim is blocked. `inconclusiveRetries` counts verifier re-runs (default `2`), so a broken verifier is retired on its own budget instead of consuming the repair budget. Both counts are folds over the recorded `claim/result` events, not plugin-held counters, so the package keeps no state that could drift from the log.

A claim left open at the turn boundary is never silently closed by the fold. Only the settlement listener or an explicit `abandon` closes a claim, so a deployment that mounts `claim` without `claim-settlement` records the last claim as `pending`.

### Durable records

The session log is the only store. Three log-only events — `claim/declared`, `claim/result`, `claim/settled` — carry no `surfaceOp`, so nothing claim-shaped reaches a request, and a resumed session folds the same `Claim[]` from the log alone. The strict fold validates non-empty `title` and `description` (reading the released `purpose` and `satisfy` payload fields when present), one frozen verifier, the closed outcome and block-code sets, and monotonic revisions; it rejects an event that is not a claim's exact next revision and a result against a settled claim, and a malformed event is rejected before commit so the log stream stays usable.

### Package topology

| Package | Role |
|---|---|
| [`packages/claim/claim`](../../../../packages/claim/claim/README.md) | `ClaimService` on `ctx.claims`: declare, record, settle, abandon; the `claim/*` events, their fold, the `claim` projection unit, and `bindVerifier` |
| [`packages/claim/tool-claim`](../../../../packages/claim/tool-claim/README.md) | `declare_claim`, `run_claim`, and `abandon_claim` tools plus the standing declaration demand as a prompt section |
| [`packages/claim/claim-settlement`](../../../../packages/claim/claim-settlement/README.md) | The `agent/turn-stopping` listener: run the verifier, steer failures, own the budget policy |

Mount all three for the complete loop. Mounting `claim` alone stores and serves claims without running or prompting anything.

## Alternatives considered

**Enforce the ordering.** Rejected: it requires writing the shared `sandbox/mode` cell or changing `sandbox-policy`'s contract, and the prompt churn breaks the cached prefix every work turn. [Ordering is not enforced](#ordering-is-not-enforced) has the full argument.

**Multiple verifiers per claim.** The settled model binds exactly one. A suite is one script that runs its members in order; a verifier array would add ordering and budget-allocation questions that one script answers by construction.

**Verifier-less claims.** An earlier draft allowed a declaration with no script, settling as `unverified`. It was removed: a claim that cannot be checked is a wish, and the folded state has to grow a fourth settlement kind to carry it. Every claim now binds exactly one required script.

**Turn-end closure in the fold.** An earlier draft closed an open claim at `turn/end` with a `settlement-did-not-run` block code. The fold now leaves the claim `pending`, because a claim left open after the boundary is a fact about the deployment, not about the work, and the settlement listener is the only component that owns the decision.

**Typed verifier registry.** Rejected: the registry was never the defense, and a dictionary entry in front of a shell command adds vocabulary without changing who authored the predicate.

**Synchronous denial of unverified work.** Rejected with the ordering argument above.

## Consequences

- **The verifier is self-written.** The agent authors its own check, so a claim verified by a vacuous script is hacking with paperwork. The freeze digest stops post-hoc swaps, not author-time games; only a user-supplied verifier would be stronger evidence, and no consumer has asked for that seam yet.
- **Ordering is advisory.** A declaration can be retrofitted mid-turn; nothing observes when it was made relative to the work.
- **Semantic claims cannot be verified.** A `description` like "the design is coherent" has no script; the agent still declares one, but the check will be a proxy at best.
- **A claim does not make remote effects stashable.** An agent that pushed a branch or sent a message before a failed verifier cannot undo it; repair steers it to fix forward, and `abandon` records that it gave up.
- **The base bundle mounts the group.** No real-composition Loader test covers the assembled graph yet; the current tests exercise each package against a real `ClaimService` with a scripted shell seam.

## Testing

- [`packages/claim/claim/tests/claim.spec.ts`](../../../../packages/claim/claim/tests/claim.spec.ts) covers the service: open-turn refusal, one claim per turn, per-turn keys, revision and failure counting, `abandon` refusal before the verifier runs, settlement shapes, live-agent authority, and log-folded replay.
- [`packages/claim/claim/tests/invariant.spec.ts`](../../../../packages/claim/claim/tests/invariant.spec.ts) exercises the invariant companion against committed event streams: unsettled turn ends, out-of-turn records, double declarations, and malformed outcomes rejected before commit.
- [`packages/claim/claim-settlement/tests/settlement.spec.ts`](../../../../packages/claim/claim-settlement/tests/settlement.spec.ts) drives the `turn-stopping` listener against a real `ClaimService` with a scripted shell seam: pass, steered failure, the default single repair re-insert with budget exhaustion, inconclusive retries, infrastructure rejection, and the tampered digest.
- [`packages/claim/tool-claim/tests/run-claim.spec.ts`](../../../../packages/claim/tool-claim/tests/run-claim.spec.ts) drives `run_claim` against a real `ClaimService` and scripted shell: pass settles, a fail is recorded with bounded evidence and leaves the claim open and abandonable, an inconclusive run stays pending, a tampered binding settles, and an id outside the open turn is rejected.
- [`packages/claim/tool-claim/tests/reminder.spec.ts`](../../../../packages/claim/tool-claim/tests/reminder.spec.ts) covers the turn-boundary reminder: appended once at each turn's first step, skipped on repair steps and agents that left the registry, and a rejection passed through untouched.

Deferred: `claim-settlement` and `tool-claim` lack a real-composition Loader test.
