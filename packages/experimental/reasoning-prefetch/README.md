---
description: "Opt-in speculative prefetch that scans sealed reasoning blocks for file and directory mentions and stages grounded content into the model's next step."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-reasoning-prefetch

## Summary

`dsh-experimental-reasoning-prefetch` eliminates orientation round trips: reasoning models settle file targets while thinking, and on the wire standards this harness serves the reasoning completes inside the same completion that later issues the reads. This plugin accumulates the live `reasoning-delta` stream per attempt, parses each sealed reasoning block exactly once at the attempt's terminal frame, grounds path-shaped spans against the session workspace (`session.header.cwd`) through the fs seam — files as bounded content reads, directories as ranked path-only listings — and offers the survivors as one durable user message riding the next step's pre-step decision, so arrival at the next request is deterministic. Prefetches start at attempt end so their I/O overlaps the attempt's own tool execution. Deltas are never parsed (a fragment is by construction a prefix of something), and files the same attempt actually called are deduplicated out before staging. No fuzzy term matching ships; fs providers are optional and read live.

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

Mount the plugin in a profile that also mounts an fs provider and an agent loop; every field is optional and validated at load:

```yaml
- name: '@deepseek-ai/dsh-experimental-reasoning-prefetch'
  config:
    maxFiles: 4
    maxFileBytes: 16384
    maxTotalBytes: 65536
    prefetchWaitMs: 50
    listLines: 40
    parsePoint: attempt-end
```

| Field | Default | Meaning |
|---|---|---|
| `maxFiles` | 4 | Content reads staged per attempt. |
| `maxFileBytes` | 16384 | Per-read ceiling; oversized files are skipped, not truncated. |
| `maxTotalBytes` | 65536 | Aggregate injected-byte ceiling per attempt. |
| `prefetchWaitMs` | 50 | How long a step's pre-step awaits in-flight staging. |
| `listLines` | 40 | Directory-listing line ceiling. |
| `parsePoint` | `attempt-end` | Accepted for compatibility; v1 stages at attempt end and rides the pre-step decision for both values. |

The accepted fields, at a glance:

```ts
export interface Config {
  maxFiles?: number
  maxFileBytes?: number
  maxTotalBytes?: number
  prefetchWaitMs?: number
  listLines?: number
  parsePoint?: 'attempt-end' | 'pre-step'
}
```

### Profile wiring: where this layer may and may not land

The shipped default (`dsh-base`'s `cordis.patch.yml`) never names this package: release bundles must not depend on experimental packages, and opt-ins stay out of shipped defaults. The layer ships with this package instead (`dsh.bundle.patch: ./cordis.patch.yml`, one insert row `id: reasoning-prefetch`) and lands wherever a deployment stacks it:

- a dev profile's `dsh.profile.bundles` / its own `cordis.patch.yml` row (source checkouts, since the package is private),
- the machine-local home layer `$DSH_HOME/cordis.patch.yml`, e.g. `- insert: [{ id: reasoning-prefetch, name: '@deepseek-ai/dsh-experimental-reasoning-prefetch' }]`,
- or a launcher `--patch` overlay pointing at `cordis.patch.yml` in this package.

Layer order is bundle defaults, then the profile's patch, then the home layer, then `--patch` overlays; budgets are set by later rows that address `id: reasoning-prefetch`, because a patch replaces its target row's whole `config`.

### What the model gets

At the next step after a reasoning block names real paths, one user message headed "Harness detected these potential reads in your reasoning stream" carries per-file content or per-directory listing lines with observed byte counts, then the contract sentence "Content is fresh as of the observed time. Use it directly; call read only if something later must be newer."

<a id="understand-the-implementation"></a>
## Understand the implementation

Span vocabulary: backticked spans, bare path tokens with a known extension and optional `:line` suffix, absolute and `~` paths, trailing-slash directory spans, and quoted strings. Bare directory spans are inert without a listing verb (*list, ls, explore, layout, structure*); backticked directory spans fall back to read under the same condition; quoted terms would need a search verb and a fuzzy layer that does not ship, so they stage nothing. An attempt whose visible response does not end at a full stop is a continuing thought and stages nothing too, and staged batches accumulate per agent until the next pre-step consumes them in order. Clean spans resolve through `ctx.fs.resolve(path, { cwd })` with the agent's session cwd and one stat; every provider failure or budget overrun silently drops the candidate. A tool-disabled knob exists only as the `[psa disable prefetch]` doc promise is deferred — see limitations.

<a id="further-exploration"></a>
## Further Exploration

- [Reasoning-driven read prefetch Agent Note](../../../.agents/notes/proposed/feature/2026-10-01-reasoning-prefetch-injection.md) — the proposed design this prototype exercises.
- [Interception extension-points Agent Note](../../../.agents/notes/implemented/feature/2026-06-30-interception-extension-points.md) — owns `agent/pre-step` and the active-batch FIFO.

<a id="model-experience"></a>
## Model Experience

Injected messages grow one request's prompt by at most `maxTotalBytes` and persist in session history until compaction, so each staged miss costs later requests too; KV-cache prefix is disturbed from the injection point onward, which the active-batch tail keeps near where tool results already churn. No thinking-token or provider-side effect.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- No fuzzy term matching (`WorkspaceFileSearch` reuse from the proposal); loose reasoning expressions are undetected by design in this prototype.
- Grep-intent staging is unimplemented: quoted terms extract but stage nothing until an executor seam is chosen.
- Session-history dedup (recaps of already-read files) is deferred; injection relies on the provenance header and contract sentence.
- No per-tool `disablePrefetch` suppression; a `[psa disable prefetch]` wrapper convention is deferred.
- Per-attempt hit-rate telemetry events are deferred; correctness is asserted through the injected message's durable log entry.
- `parsePoint` is accepted for compatibility only; v1 stages at attempt end and rides the next pre-step decision for both values. The note's `inject()`-FIFO and in-request staging variants are deferred.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The span and verb vocabularies live in `src/extract.ts` as pure functions; staging lives in `src/stage.ts`; both are unit-testable without the loop.

</details>
