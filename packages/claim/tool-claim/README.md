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

- **The demand is a prompt section, not a per-turn injection.** The declaration requirement is stable text registered through `ctx.systemPrompt.section` under the `TOOL_CLAIM` order slot, so it needs no re-injection, no rewrite, and no turn scoping. The package registers no `agent/pre-step` listener.
- **Tools own the model-facing surface.** The package validates only what the tool boundary needs — a calling agent, a non-empty done-condition — and delegates every state rule to `ctx.claims`, so tool and service cannot disagree about what a legal claim is.
- **Authority is the live agent.** Both tools resolve `exec.agent` and require it to be the registry's current instance.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Function plugin: the two tools, the demand constant, and the prompt section |

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

One prompt section, always present, stating that the agent must declare what "done" means with `declare_claim` and bind the check that proves it, that a claim is immutable once declared, that it may be abandoned once its check has run, and that the bound verifier runs when the turn is about to end. The package also contributes the two tool schemas.

#### Token effect

Fixed. The section is constant text paid on every request; it does not grow with the session and is not repeated per turn.

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
- **No tests yet.** The package has no test file, so the per-file coverage gate does not cover its tool schemas or prompt text; adding `tests/` is deferred work.

**Runtime invariant:** No companion is published. This package owns no durable event stream of its own; every state change it causes is a `claim/*` event validated by the `dsh-claim` fold, so an independent observation here would duplicate that fold rather than diverge from it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
