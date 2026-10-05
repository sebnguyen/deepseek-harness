---
description: "Per-turn staged escalation: an explore-then-act gate that denies act tools until turn-local evidence, with a narrow-only sandbox clamp and a request_escalation crossing."
kind: "package"
---

# @deepseek-ai/dsh-staged-escalation

## Summary

Staged escalation names two phases in every turn — explore then act — and enforces the border with friction, not security: until the turn logs a successful explore-tier call, act-tier tools return a staged Error (the catalog and prompt cache are untouched — deny, never hide) and the `sandbox-policy/resolve` waterfall clamps the file and shell fences narrow-only. `request_escalation` is the affirmative crossing: it routes through the shared approval seam, and the plugin's mechanical answerer grants when the turn's fold already satisfies the requested stage. The current stage is a pure fold of the turn's session log, so each user message re-arms the ladder and a resumed session re-derives it with no hidden state.

## Contents

- [Model experience](#model-experience)
- [The stage ladder](#the-stage-ladder)
- [Invariant](#invariant)

-----

<a id="model-experience"></a>
## Model experience

The tool catalog is byte-identical across lock, unlock, and restart: the gate denies through `tools/pre-execute`, fires no `tools/change` event, and never calls `tools.restrict`. Locked turns receive one synthetic reminder user message at step 1, sourced `staged-escalation`, whose body is the current stage's configured `description` verbatim under a `You are in the "<name>" stage.` header. Denials are one line: `This tool is blocked due to your "<stage>" stage — trigger request_escalation when you are ready to proceed to the next stage.` The static Core Rule section `staging:core-rule` ships exactly where the gate composes.

<a id="the-stage-ladder"></a>
## The stage ladder

`Config.stages` is the ladder; the array index is the tier. Each stage names its `allow` tools (a lone `'*'` on the last stage admits every unlisted and future tool), its widest `sandbox` mode, a `name`, and the rationale-led `description` paragraph the reminder injects verbatim. The shipped default is `explore` (probes, reads, shell searches, questions; `read-only` fence, so the shell lists and searches but cannot mutate) then `act` (`'*'`; `workspace-write`). Validation throws at load on an empty ladder, a duplicated or empty name, an empty description, an empty stage, or a `'*'` anywhere but alone on the last stage. `turnStartReminder: false` removes the step-1 reminder for deployments that rely on denials alone.

<a id="invariant"></a>
## Invariant

This package ships no `./invariant` module and no wiring: the reminder, the denial, the sandbox clamp, and the escalation answerer all read the same `currentStage` fold over the same session log, so there is no second observation whose divergence a runtime check could detect; the cross-seam agreement (pre-execute deny and resolve clamp) is pinned by the behavior specs instead.
