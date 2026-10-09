---
description: "Git capability seam: provider registry and read-only repository status/diff execution against HEAD."
kind: "package-reference"
---

# @deepseek-ai/dsh-git

## Summary

`dsh-git` declares the git capability seam: one `ctx.git` service holding a provider registry and execution-time provider selection for two read-only repository queries, `status` (worktree state relative to HEAD) and `diff` (one file's HEAD and worktree texts). Consoles such as the web file explorer consume `status` for change badges and `diff` for an Open Changes view; providers read the repository through whatever filesystem the Host composes. The seam enforces deployment caps a request may narrow but never widen, and resolves its provider at call time so selection never depends on registration order. Use it when a product surface needs git-relative facts; the session-scoped change record remains the checkpoint subsystem's job.

## Table of Contents

- [Use this package](#use-this-package)
- [Selection semantics](#selection-semantics)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service before any provider registers into it.

```yaml
- name: '@deepseek-ai/dsh-git'
  config:
    maxEntries: 5000
    maxFileBytes: 33554432
```

| Field | Default | Meaning |
|---|---|---|
| `provider` | none | Explicit provider id; omitted auto-selects when exactly one usable provider is registered |
| `maxEntries` | `5000` | Inclusive cap on one status result's entries; a request may narrow, never widen |
| `maxFileBytes` | `32 * 1024 * 1024` | Inclusive byte cap on one diff side's text |

Providers register through `registerProvider` and receive a disposer; the returned disposer and the owning fiber both unregister.

<a id="selection-semantics"></a>
## Selection semantics

| Registry state at call time | Outcome |
|---|---|
| Configured id registered and available | that provider |
| Configured id not registered | `GitError` `GIT_PROVIDER_CONFIGURED_MISSING` |
| Configured id registered, unavailable | `GitError` `GIT_PROVIDER_CONFIGURED_UNAVAILABLE` |
| No id configured, exactly one usable provider | that provider |
| No id configured, multiple usable | `GitError` `GIT_PROVIDER_AMBIGUOUS` |
| No id configured, none usable | `GitError` `GIT_PROVIDER_UNAVAILABLE` |

`status` cuts an over-long provider result to the effective cap and sets `truncated`; `diff` forwards the provider's texts after the provider cut each side to the effective cap.

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

Nothing directly. The seam serves Host surfaces and remote methods; no tool schema, prompt section, or session event rides it.

#### Token effect

None: no request context reads the seam.

#### KV Cache effect

None: no model-visible input changes when the seam is mounted.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Status-only surface** — log, blame, commit, and stack operations have no seam methods; a Consumer needing them grows the seam in a later decision, not a provider escape hatch.
- No `./invariant` companion is published because the registry is the single source of truth and no independent observation of it can diverge.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The seam mirrors the web capability seam's registry-and-selection shape on purpose: one proven selection table instead of a second design.

</details>
