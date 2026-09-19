---
description: "The model-facing verification-claim tools for users and maintainers configuring how an agent declares and abandons a done-condition."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-claim

## Summary

`dsh-tool-claim` gives the model two tools — `declare_claim` to state why the turn exists, what must be true when it completes, and the one shell check that proves it, and `abandon_claim` to give up on a claim that named the wrong condition — and contributes the standing demand that tells the model to open each turn with a claim. Mount it beside `dsh-claim`; the service stores claims and `dsh-claim-settlement` runs their checks.

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

Mount `dsh-tool-claim` beside `dsh-claim` and a shell executor. It requires `ctx.agents`, `ctx.claims`, `ctx.tools`, `ctx.systemPrompt`, and `ctx.sessionProjections`, and takes no configuration.

### The tools

| Tool | Input | What it does |
|---|---|---|
| `declare_claim` | `purpose` (required), `satisfy` (required), `script` (required) | Opens the turn's claim, hashing `script` into the one frozen verifier |
| `abandon_claim` | `reason` (required) | Closes the open claim as blocked because the condition was wrong |

Both return the compact claim status — id, turn, revision, `purpose`, `satisfy`, and the settlement kind — rather than the whole record.

`abandon_claim` is refused until the bound check has run at least once, so an agent cannot declare a claim and immediately walk away from it. Every claim binds exactly one script; a declaration without one is refused at the tool boundary.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design

- **The demand is a prompt section plus a turn-boundary reminder.** The declaration requirement is stable text registered through `ctx.systemPrompt.section` under the `TOOL_CLAIM` order slot. An `agent/pre-step` waterfall listener appends one plugin-sourced reminder message at the first step of every turn, so the agent receives an explicit model-visible turn marker instead of inferring the boundary from the transcript; the loop logs injected pre-step messages as `user/message` events, keeping model-visible identical to logged.
- **Tools own the model-facing surface.** The package validates only what the tool boundary needs — a calling agent, a non-empty done-condition — and delegates every state rule to `ctx.claims`, so tool and service cannot disagree about what a legal claim is.
- **Authority is the live agent.** Both tools resolve `exec.agent` and require it to be the registry's current instance.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Function plugin: the two tools, the demand constant, the pre-step reminder, and the prompt section |
| [`tests/reminder.spec.ts`](tests/reminder.spec.ts) | Reminder timing, pass-through, and live-agent gating |

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

One prompt section, always present, stating that the agent must declare what "done" means with `declare_claim` and bind the check that proves it, that a claim is immutable once declared, that it may be abandoned once its check has run, and that the bound verifier runs when the turn is about to end. Each turn's first step also receives a short plugin-sourced reminder message naming the turn and pointing at `declare_claim`. The package also contributes the two tool schemas.

#### Token effect

Fixed for the section; one short reminder line is appended at each turn's first step. Neither grows with the session.

#### KV Cache effect

None beyond its own presence. The text never changes between requests, so it sits inside the cached prefix rather than invalidating it.

### Tool results

#### What the model sees

Each call returns `{ claim: { id, turn, revision, purpose, satisfy, settlement } }`, or `{ claim: null }` when no claim exists.

#### Token effect

Small and bounded: six fields, independent of how long the purpose or satisfy prose is.

#### KV Cache effect

Append-only. Tool results follow the reusable request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package needs special care. They are current constraints, not a task backlog.

- **The demand is a prompt, not an enforcement.** Nothing forces the agent to call `declare_claim`; an agent that ignores it simply ends the turn without a claim. The group is deliberately advisory about ordering.
- **No claim editing.** The tools can open and abandon a claim but not revise one, matching the service's immutability.
- **The reminder fires on every turn's first step.** There is no work-turn discrimination; a chat-shaped turn receives the reminder too, and it pays one short appended message per turn.

**Runtime invariant:** No companion is published. This package owns no durable event stream of its own; every state change it causes is a `claim/*` event validated by the `dsh-claim` fold, so an independent observation here would duplicate that fold rather than diverge from it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
