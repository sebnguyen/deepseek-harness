---
description: "Decision-model skill admission: judges each catalog skill at every pre-step and injects the bodies the judgment admits, for users and maintainers configuring or debugging the plugin."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-context

English | [中文](README.zh.md)

## Summary

This package admits skill bodies into the model's window on a decision model's judgment instead of leaving selection to the model. At every `agent/pre-step` it sends one Noul question per model-invocable skill to `ctx.decision` and emits a `skill-invocation` injection for each skill the answer admits. A skill whose body already sits in the window is never emitted again, so a repeated judgment emits nothing. Every unclear case holds: an absent provider, an incomplete catalog observation, or a disabled plugin leaves the window exactly as it was.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when a judgment, not the model, should decide which skill bodies enter the window. Nothing mounts it by default, so a profile patch adds it explicitly.

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Whether the pre-step judgment runs at all. |
| `provider` | `'typesafe'` | Where judgments come from; `none` keeps `ctx.decision` without an evaluator. |
| `threshold` | `0.5` | Probability above which a candidate is admitted, in `(0, 1]`. |
| `topK` | `3` | Maximum skills admitted per step. |
| `model` | required for `typesafe` | Pinned model identifier; an alias would retune a threshold without notice. |
| `endpoint` | the TypeSafe evaluation endpoint | Evaluation endpoint. |
| `timeoutMs` | `10000` | Per-call timeout. |

A `typesafe` provider without a `model`, a threshold outside `(0, 1]`, and a non-positive `topK` each fail at load rather than degrading.

<a id="understand-the-implementation"></a>
## Understand the implementation

`ctx.decision` is the capability: one call carries a state and a list of typed questions and returns typed answers. The definition ships in this package because one provider serves its one Consumer here; a second provider or Consumer is the trigger to extract it.

The plugin reads the live window with `Session.deriveMessages()`, the derived projection: the surface is its single source, so a compaction `replace` removes a shadowed injection from the derivation and each surface node is projected once. It never resolves event positions, because the synchronous arbitrary-position readers are deprecated.

Admission holds whenever the judgment would be unsound — an incomplete catalog observation would otherwise answer an incomplete question set and deny a skill the model needed.

## Model Experience

### Request context and condition

The plugin adds one durable user-role message per admitted skill, before the step's request. Each carries the released `skill-invocation` source (`kind`, `name`, `form: 'instructions'`) and the rendered `<skill_content>` body.

#### What the model sees

The skill's own instruction body, inside the same `<skill_content>` block a `/name` gesture produces. The catalog frame and the `skill` tool schema are unchanged.

## Known Limitations and Deferred Work

The judgment reads relevance, not outcome evidence, so it can reduce context while missing the same skills the model misses. Admission is add-only: a skill body stays in the window until compaction shadows it, so remaining capacity is monotonically non-increasing and a skill denied for want of room stays denied unless compaction reclaims space.

Every admission is durably recorded as a `skill-invocation`, the same source kind a user gesture produces, so the log does not distinguish a judged admission from a hand-loaded skill.

## Dev Note

Run `pnpm exec vitest run packages/context/skill-context/tests/skill-context.spec.ts` for the focused coverage.
