---
description: "Turn-boundary settlement of verification claims for users and maintainers configuring verifier execution, the repair budget, and failure steering."
kind: "package-reference"
---

# @deepseek-ai/dsh-claim-settlement

## Summary

`dsh-claim-settlement` runs each open claim's bound verifier when the turn is about to close and decides what happens next: close the claim on success, steer the failure back for repair while budget remains, or block it once budget is spent. It owns the repair policy; `dsh-claim` stores the outcome. It consumes the loop's serial `agent/turn-stopping` point, which the Claude Code and Codex hook bridges also use for their stop hooks.

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

Mount it beside `dsh-claim` and a shell executor. It requires `ctx.agents`, `ctx.claims`, and `ctx.shell`.

```yaml
- name: '@deepseek-ai/dsh-claim-settlement'
  config:
    repairBudget: 1
    inconclusiveRetries: 2
```

| Field | Default | Meaning |
|---|---|---|
| `repairBudget` | `1` | Repair steers allowed for one claim before it is blocked |
| `inconclusiveRetries` | `2` | Verifier re-runs allowed after an inconclusive result |
| `verifierTimeoutMs` | `600000` | Per-run verifier timeout |
| `evidenceLines` | `40` | Evidence lines kept when steering a failure back |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-claim-settlement) is the exhaustive source for every accepted field.

### What each outcome does

| Verifier outcome | Settlement behavior |
|---|---|
| `pass` | Closes the claim as `passed` |
| `fail` | Steers the verifier output back for repair; blocks as `repair-budget-exhausted` once the budget is spent |
| `inconclusive` | Retries the verifier without steering; blocks as `verifier-unavailable` once the retries are spent |
| `tampered` | Blocks immediately; never retried |

`repairBudget` counts **steers**, so the default `repairBudget: 1` runs the verifier at most twice: once when the turn first tries to close, then once after the single repair round the model is granted. A claim the model settles itself with `run_claim` never reaches that path; the boundary only verifies what the model left open.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design

- **Steering is the only way a listener objects.** `agent/turn-stopping` is serial and returns no decision, so the effect travels as a queued message: the listener steers, the loop re-reads its inbox, and the turn runs another step. Declining to steer on exhaustion is what lets `turn/end` commit.
- **The listener never throws.** `turn-stopping` is awaited before the turn boundary commits, and a listener failure would close the turn as an error instead of settling the claim. Every failure mode degrades to an outcome: executor rejections and killed runs become `inconclusive`, and a throw anywhere in the listener settles the claim as `blocked` with `verifier-unavailable`.
- **The attempt count is a fold.** Budgets are computed by counting recorded results, not by a counter the plugin holds, so the package keeps no state that could drift from the log.
- **Freeze checked before every run.** The verifier's script is re-hashed immediately before execution; a mismatch is `tampered` and is never retried.
- **The claim field is the single verifier.** A claim binds exactly one verifier, so there is no predicate ordering or fan-out to settle.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `turn-stopping` listener, budget policy, and steering |
| [`src/verifier.ts`](src/verifier.ts) | Freeze check, shell execution, and outcome mapping |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Claim group map](../README.md) — the sibling packages and how they compose.
- [Agent-loop package](../../core/agent-loop/README.md) — the turn and step machine whose `turn-stopping` point this package consumes.
- [Shell capability](../../shell/shell/README.md) — the executor contract the verifier runs through.

-----

<a id="model-experience"></a>
## Model Experience

### Steered failure evidence

#### What the model sees

When a bound verifier fails and budget remains, one plugin-sourced user message carrying the failed outcome, the declared condition, the tail of the verifier's output, and the instruction to repair the work and re-run the claim with `run_claim` or abandon it. Nothing is steered for a pass, for a tampered verifier, or once a budget is spent. This package contributes no prompt section and registers no tool, so the steered message is its entire model-visible surface.

#### Token effect

Adds the steered message plus the later model step it causes. The evidence is truncated to `evidenceLines` before it is steered, so the cost is bounded by configuration rather than by how much the verifier printed.

#### KV Cache effect

Append-only. The steered message lands after the existing history and does not alter the cached prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package needs special care. They are current constraints, not a task backlog.

- **Nothing establishes that a verifier is a sound test.** The package records what ran and rechecks the freeze; it cannot tell a meaningful check from a vacuous one an agent froze before starting.
- **Repeated identical failures re-run the verifier.** An artifact that did not change since the last failure is verified again rather than detected as unchanged, because remembering the previous artifact state would add a second source of truth to save at most `repairBudget` executions.
- **Read-only isolation is not enforced here.** A verifier runs through the composed shell executor with that executor's capabilities; the package does not itself sandbox the run.

**Runtime invariant:** No companion is published. This package writes no session event of its own — every outcome it produces is recorded through `ctx.claims` and validated by the `dsh-claim` fold — and the budget it enforces is a fold over those recorded results rather than state it owns.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is not authoritative for shipped behavior.

A real-composition test through the Loader is still outstanding; the current settlement tests exercise the listener against a real `ClaimService` with a scripted shell seam, which covers the policy but not the assembled plugin graph.

</details>
