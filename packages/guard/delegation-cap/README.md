---
description: "Guard plugin that denies delegation-tool starts beyond a per-turn cap so spawning sprees collapse into errored results the model can convert to todos"
kind: "package-reference"
---

# @deepseek-ai/dsh-delegation-cap

## Summary

This package registers one monotonic tool guard that counts the current turn's logged `tool/call` events for the configured delegation tools and denies any start beyond `maxDelegationsPerTurn`. The denied call stays model-visible and surfaces as an errored result carrying the cap and the corrective advice, so the child shape of a wind-up/wind-down composition is deployment policy rather than model habit. It neither rewrites calls nor vetoes anything else.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside the tool registry when a deployment wants delegation spawns bounded per turn.

```yaml
- name: '@deepseek-ai/dsh-delegation-cap'
  config:
    tools: [subagent, explore]
    maxDelegationsPerTurn: 20
```

| Field | Default | Meaning |
|---|---|---|
| `tools` | required, non-empty | Global tool names the cap counts |
| `maxDelegationsPerTurn` | required | Counted starts per turn; `0` forbids delegation entirely for the named tools |
| `batchParameter` | `tasks` | Array parameter whose entries also count as starts, so one batched call counts as `1 + entries.length` starts |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-delegation-cap) is the exhaustive source for every accepted field and its JSDoc.

<a id="understand-the-implementation"></a>
## Understand the implementation

The shipped YAML shape boots through the vendored Loader and denies the cap-plus-one start in a real composition (`tests/loader-composition.spec.ts`). The guard walks the calling agent's session log backwards from its tail: the last `turn/start` fixes the current turn, and `tool/call` events for counted names since then form the count, adding one for each entry of the counted call's batch array parameter so a batched fan-out call cannot route around the cap that counts separate calls. The proposed call's own `tool/call` is logged before guards run, so the (cap+1)-th start in one turn is the first denied one; a denial returns the guard's reason string and the pipeline maps it to the errored tool result. Tools outside the configured set cost nothing beyond the name check.

<a id="model-experience"></a>
## Model Experience

The model sees the named delegation tools at all times, including past the cap. A denied call returns an error whose text states the cap, the turn scope, and the advice to convert the last handoff into todo items; retries inside the same turn keep failing, while the next turn starts from zero.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The count folds the session log per counted call, so very long turns pay a backward scan; a cheap per-session counter would need the guard to own turn-boundary lifecycle state the registry does not expose.
- The cap is per-turn, not per-session: a parent that wants more readers across turns can get them one batch per turn by design.
