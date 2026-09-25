---
description: "The model-facing verification-claim tools for users and maintainers configuring how an agent declares, runs, and settles a done-condition."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-claim

## Summary

`dsh-tool-claim` gives the model four tools — `declare_claim` to state what must be true when the turn completes and the one shell check that proves it, `run_claim` to run that check inside the turn and settle the claim on a pass, `abandon_claim` to give up on a claim that named the wrong condition, and `list_claims` to read back what the turn declared — and contributes the standing demand that tells the model to open coding turns (repo edits or verification) with one or more claims while skipping claims on explanation-only turns. Mount it beside `dsh-claim`; the service stores claims and `dsh-claim-settlement` verifies any claim the model never runs itself.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount `dsh-tool-claim` beside `dsh-claim`, a shell executor, and `dsh-claim-settlement`. It requires `ctx.agents`, `ctx.claims`, `ctx.tools`, `ctx.systemPrompt`, `ctx.sessionProjections`, and `ctx.shell`.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `verifierTimeoutMs` | `600000` | Per-run timeout for a `run_claim` verifier execution |
| `evidenceLines` | `40` | Evidence lines kept in a `run_claim` result |

### The tools

| Tool | Input | What it does |
|---|---|---|
| `declare_claim` | `title` (required), `description` (required), `script` (required) | Opens one claim of the turn, hashing `script` into the one frozen verifier |
| `run_claim` | `id` (required) | Runs the claim's bound check now; a pass settles the claim, a fail or inconclusive result is recorded and the claim stays open |
| `list_claims` | none | Lists every claim this turn declared, pending or settled, in declaration order |
| `abandon_claim` | `id` (required), `reason` (required) | Closes the claim as blocked because the declared condition was the wrong one |

`declare_claim`, `run_claim`, and `abandon_claim` return the compact claim status — id, turn, revision, `title`, `description`, and the settlement kind; `run_claim` additionally returns the recorded `outcome` and the verifier output bounded to the `evidenceLines` tail. `list_claims` returns the roster of this turn's claims — each claim's `id`, `title`, `description`, and settlement kind — and an empty roster when the turn declared none.

`list_claims` exists because claim identity lives in the transcript: a turn whose earlier steps were compacted away, or a turn resumed after its declaration messages fell out of context, still has to settle the claims it declared. The durable ledger in the session log holds them regardless, so the tool reads the open turn's claims back by `turn`, not from conversation memory.

`abandon_claim` is refused until the bound check has run at least once — through `run_claim` or the turn-boundary settlement — so an agent cannot declare a claim and immediately walk away from it. Every claim binds exactly one script; a declaration without one is refused at the tool boundary. A claim the model never runs is still verified at the turn boundary, which steers its failure back once for repair.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design

- **The demand is a prompt section plus a turn-boundary reminder.** The declaration requirement is stable text registered through `ctx.systemPrompt.section` under the `TOOL_CLAIM` order slot. An `agent/pre-step` waterfall listener appends one plugin-sourced reminder message at the first step of every turn, so the agent receives an explicit model-visible turn marker instead of inferring the boundary from the transcript; the loop logs injected pre-step messages as `user/message` events, keeping model-visible identical to logged.
- **Tools own the model-facing surface.** The package validates only what the tool boundary needs — a calling agent, a non-empty done-condition — and delegates every state rule to `ctx.claims`, so tool and service cannot disagree about what a legal claim is. Execution of the frozen verifier and evidence bounding come from `dsh-claim-settlement`, so an in-turn run and a boundary run classify a result identically.
- **Authority is the live agent.** All four tools resolve `exec.agent` and require it to be the registry's current instance.
- **Claim identity survives compaction because the log, not the transcript, is the store.** `list_claims` reads `ctx.claims.turnClaims`, the open turn's claims from the durable ledger, so a compacted or trimmed transcript never loses which claims a turn still owes.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Function plugin: the four tools, the demand constant, the pre-step reminder, and the prompt section |
| [`tests/reminder.spec.ts`](tests/reminder.spec.ts) | Reminder timing, pass-through, and live-agent gating |
| [`tests/run-claim.spec.ts`](tests/run-claim.spec.ts) | In-turn run outcomes, evidence bounding, and the abandoned-after-running path |
| [`tests/list-claims.spec.ts`](tests/list-claims.spec.ts) | The turn-scoped roster, the empty turn, and the live-agent gate |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Claim group map](../README.md) — the sibling packages and how they compose.
- [Tools subsystem](../../../docs/subsystems/tools.md) — the registry and guarded pipeline these tools register into.
- [Goal tools](../../goal/tool-goal/README.md) — the sibling tool package whose plugin shape and prompt-section placement this package follows.

-----

<a id="model-experience"></a>
## Model Experience

### The declaration demand

#### What the model sees

One prompt section, always present, stating when claims apply (coding turns only), how to declare one or more claims with `declare_claim` — one claim per independent condition — bind the check that proves each one, keep a claim's content immutable once declared, settle claims itself with `run_claim`, abandon a claim once its check has run and the condition itself was wrong, call `list_claims` when the transcript no longer shows what the turn declared, and expect one steered repair round for any claim it never runs. Each turn's first step also receives a short plugin-sourced reminder naming the turn, when to skip claims, and when to declare and settle them. The package also contributes the four tool schemas.

#### Token effect

Fixed for the section; one short reminder line is appended at each turn's first step. Neither grows with the session.

#### KV Cache effect

None beyond its own presence. The text never changes between requests, so it sits inside the cached prefix rather than invalidating it.

### Tool results

#### What the model sees

Each of `declare_claim`, `run_claim`, and `abandon_claim` returns `{ claim: { id, turn, revision, title, description, settlement } }`, or `{ claim: null }` when no claim exists. A `run_claim` result also carries `outcome` and `evidence`, the verifier's output bounded to the `evidenceLines` tail. `list_claims` returns `{ claims: [{ id, title, description, settlement }] }`, this turn's claims in declaration order and an empty array when the turn declared none.

#### Token effect

Small and bounded: the six status fields plus, for `run_claim`, the configured evidence tail — independent of how long the title or description prose is. A `list_claims` roster is one short record per claim the turn declared, and claims per turn are few.

#### KV Cache effect

Append-only. Tool results follow the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package needs special care. They are current constraints, not a task backlog.

- **The demand is a prompt, not an enforcement.** Nothing forces the agent to call `declare_claim`; an agent that ignores it simply ends the turn without a claim. The group is deliberately advisory about ordering.
- **No claim editing.** The tools can open, run, list, and abandon a claim but not revise one, matching the service's immutability.
- **Recovery is model-initiated.** Nothing re-injects the roster when a transcript is compacted mid-turn; the demand section and the tool schema are the only cues to call `list_claims`, so a model that never calls it still loses the turn's claim ids.
- **The reminder fires on every turn's first step.** There is no work-turn discrimination; a chat-shaped turn receives the reminder too, and it pays one short appended message per turn.

**Runtime invariant:** No companion is published. This package owns no durable event stream of its own; every state change it causes is a `claim/*` event validated by the `dsh-claim` fold, so an independent observation here would duplicate that fold rather than diverge from it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
