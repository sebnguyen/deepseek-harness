---
description: "Package map for the git capability family: the read-only repository seam and its isomorphic-git provider over the composed filesystem."
kind: "package-group"
---

# git/ — git capability family

## Summary

The `git/` packages give Host surfaces git-relative facts — worktree status against HEAD and single-file diffs — through the `ctx.git` seam. Because the provider reads through the composed `ctx.fs` filesystem, the same provider serves local and remote or sandboxed execution worlds; the seam itself only holds the registry, the selection policy, and the deployment caps. Session-scoped change records (what the agent wrote this session) remain the checkpoint subsystem's vocabulary; this family answers the orthogonal question of what changed against the repository.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Two packages play the git roles; the subsystem reference owns the vocabulary and contracts.

| Package | Role | ctx key |
|---|---|---|
| [`git/`](git/README.md) | Read-only repository seam: provider registry, selection, and deployment caps for status and diff | `ctx.git` |
| [`git-isomorphic/`](git-isomorphic/README.md) | Runs status and diff through isomorphic-git over the composed `ctx.fs` filesystem | registers on `ctx.git` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Git subsystem](../../docs/subsystems/git.md) — the `GitStatusResult`/`GitFileDiff` vocabularies, provider contract, and `GitError` codes.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
