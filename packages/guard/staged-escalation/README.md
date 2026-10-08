---
description: "Per-turn staged escalation: an explore-then-act gate that denies act tools until request_escalation, which grants on the call itself, with a narrow-only sandbox clamp."
kind: "package"
---

# @deepseek-ai/dsh-staged-escalation

## Summary

Staged escalation names two phases in every turn — explore then act — and enforces the border with friction, not security: act-tier tools return a staged Error (the catalog and prompt cache are untouched — deny, never hide) until `request_escalation` crosses, and the `sandbox-policy/resolve` waterfall clamps the file and shell fences narrow-only while locked. `request_escalation` is the one crossing, visible on every act turn: the tool returns the grant itself and does not ask the approval seam, so a `never` approval policy cannot decline it, and no explore evidence is required. The granted stage is a pure fold of the turn's session log, so each user message re-arms the ladder and a resumed session re-derives it with no hidden state.

## Contents

- [Model experience](#model-experience)
- [The stage ladder](#the-stage-ladder)
- [Invariant](#invariant)

-----

<a id="model-experience"></a>
## Model experience

The tool catalog is byte-identical across lock, unlock, and restart: the gate denies through `tools/pre-execute`, fires no `tools/change` event, and never calls `tools.restrict`. Locked turns receive one synthetic reminder user message at step 1, sourced `staged-escalation`, whose body is the current stage's configured `description` verbatim under a `You are in the "<name>" stage.` header. Denials are one line: `This tool is blocked due to your "<stage>" stage — trigger request_escalation when you are ready to proceed to the next stage.` The one exempt call is a schema child's `structured_output` — the child's return statement, not a staged act — so the gate never denies a child its only result channel. The static Core Rule section `staging:core-rule` ships exactly where the gate composes.

<a id="the-stage-ladder"></a>
## The stage ladder

`Config.stages` is the ladder; the array index is the tier. Each stage names its `allow` tools (a lone `'*'` on the last stage admits every unlisted and future tool), its widest `sandbox` mode, a `name`, and the rationale-led `description` paragraph the reminder injects verbatim. The shipped default is `explore` (probes, reads, shell searches, `gh` GitHub-side lookups, questions; `read-only` fence, so the shell lists and searches the workspace but cannot mutate it) then `act` (`'*'`; the fence resolves at the deployment's standing mode, because the narrow-only clamp caps the topmost stage entry at the configured policy). Validation throws at load on an empty ladder, a duplicated or empty name, an empty description, an empty stage, or a `'*'` anywhere but alone on the last stage. `turnStartReminder: false` removes the step-1 reminder for deployments that rely on denials alone. Under `DSH_SNAPSHOT=replay` or `refresh` the gate and the sandbox clamp floor at the top rung — both keyless lanes re-execute recorded act calls whose `request_escalation` crossings are already spent — while the step-1 reminder rides the raw fold so replayed turns re-emit the recorded reminder.

<a id="invariant"></a>
## Invariant

This package ships no `./invariant` module and no wiring: the reminder, the denial, and the sandbox clamp all read `currentStage`, the fold of logged `request_escalation` grants, so there is no second observation whose divergence a runtime check could detect. The tool writes that grant directly; the behavior specs pin the deny, the clamp, and the grant together.
