---
description: "Read-only git provider over the composed dsh-fs filesystem, backed by isomorphic-git."
kind: "package-reference"
---

# @deepseek-ai/dsh-git-isomorphic

## Summary

`dsh-git-isomorphic` registers one read-only git provider on `ctx.git`: isomorphic-git's `statusMatrix` and `readBlob` run over an adapter that translates every read onto the composed `ctx.fs` filesystem, so the same provider serves local and remote execution worlds. Reads synthesize the Node-stats fields isomorphic-git posixifies from `dsh-fs` metadata, translate absence to `ENOENT`, and refuse mutation-shaped fs calls with `EROFS` — the provider never writes. Binary files (NUL bytes) refuse `diff` with `GIT_NOT_TEXT`; non-repository roots refuse with `GIT_NOT_REPOSITORY`. Roots the composed filesystem maps to Host paths get their status walk on a worker thread instead, because isomorphic-git hashes every changed file in process and the Host event loop must not host that.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount after the service seam and the filesystem it reads:

```yaml
- name: '@deepseek-ai/dsh-git-isomorphic'
  config:
    id: isomorphic-git
    maxFileBytes: 33554432
```

| Field | Default | Meaning |
|---|---|---|
| `id` | `isomorphic-git` | Registry key the provider registers under |
| `maxFileBytes` | `32 * 1024 * 1024` | Inclusive byte cap on one internal read and one diff side a request does not narrow |

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

Nothing directly. The provider serves Host surfaces through the seam.

#### Token effect

None.

#### KV Cache effect

None.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Synthetic stats** — mtimes, ctimes, devs, and inos are constant zeros, so isomorphic-git's index short-circuit never matches and every status re-hashes changed files; correct, slower than a node:fs provider on large worktrees.
- **One process path per read** — every adapter call resolves through `ctx.fs.resolve`, so a status walk pays one resolve per entry.
- **No symlink reads** — `readlink` and `symlink` are not part of the adapter; repositories whose worktree links the provider refuses to follow are read through their resolved targets only.
- No `./invariant` companion is published because the provider is stateless: every fact returns to a fresh read of the composed filesystem.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`isomorphic-git` resolves against this package's own dependency, not a root hoist; the worker closure in `src/walk.ts` carries the second import deliberately.

| File | Role |
|---|---|
| `src/adapter.ts` | Host-read shim isomorphic-git posixifies; translates absence to `ENOENT` and mutation-shaped calls to `EROFS` |
| `src/provider.ts` | `IsomorphicGitProvider`: walks, row mapping, diff reads, and the host-path gate between adapter and worker walks |
| `src/status-rows.ts` | The shared statusMatrix row decoder both walks use |
| `src/walk.ts`, `src/worker.ts` | The self-contained host-disk walk and its worker-thread entry |
| `src/runner.ts` | `GitWalkRunner`: lazy worker, per-root in-flight deduplication, queued replies, disposer |

The worker entry boots two ways: dev-time module runners (vitest, tsx) launch `worker.ts` directly, the built face launches `lib/worker.cjs` beside `lib/index.js`; `index.ts`'s extension picks the one. `execArgv: []` keeps the thread hermetic in both.

</details>
