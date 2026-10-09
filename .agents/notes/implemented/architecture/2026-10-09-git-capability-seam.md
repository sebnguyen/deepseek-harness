# Agent Note: Read-Only Git Capability Seam over the Composed Filesystem

Status: implemented

## Problem

Host surfaces needed git-relative facts — the web file explorer's change badges and an Open Changes diff — for Session workspaces, including execution worlds whose disk the Host process cannot open (sandboxes, remote backends). Running the `git` binary answers only the local world; reading `.git` directly from `node:fs` repeats that limit and breaks the same way. Ad-hoc `status --porcelain` output also gives Consumers no stable vocabulary to switch on.

## Decision

Git is a capability seam: `dsh-git` owns `ctx.git`, a provider registry with web-seam selection semantics and deployment caps, exposing exactly `status` (worktree state relative to HEAD as the closed five-state `GitFileStatus`) and `diff` (one file's HEAD and worktree texts). `dsh-git-isomorphic` registers the only provider: isomorphic-git's `statusMatrix` and `readBlob` over a promise-fs adapter whose reads translate onto `ctx.fs` (`readBytes`, `listDir`, `stat`, `lstat`), synthesizing the Node-stats fields isomorphic-git posixifies and reporting `ENOENT` for absence. Mutation-shaped adapter members refuse `EROFS`. The seam's Consumer is the `workspaceFiles` remote's `scmStatus`, which a seam-less Host answers `present: false` and which folds a `GIT_NOT_REPOSITORY` workspace into `notRepository` so an un-versioned workspace draws no badges. Uncommitted-but-tracked content reaches badges through `status`; write-ops (commit, branch) deliberately have no seam method until a Consumer appears.

## Alternatives considered

- **Spawn the `git` binary** — fastest on large local worktrees and battle-tested, but answers only where the binary runs; a sandboxed or remote execution world would need its own provider anyway, and a second provider later does not invalidate the seam.
- **node:fs-direct isomorphic-git** — a simpler first provider, but duplicates the local-only limit the adapter exists to remove; the adapter is the same code with reads rebound.
- **Extend dsh-fs with write/unlink/mkdir** — would let isomorphic-git manage the repository fully, but grows the filesystem seam for a single consumer; read-only git needs none of those operations.
- **Fold status into the workspace-files feed (`fs/observed`)** — observations record what the agent did this session, not what changed against HEAD; the two views are distinct authorities and stay separate.

## Consequences

- The explorer joins git-relative and session-scoped facts at render time: badges read `scmStatus`, reveal and checkpoint slots keep their own authorities.
- Every adapter read costs one `ctx.fs.resolve`, and the synthesized zero stats disable isomorphic-git's index short-circuit, so a status walk re-hashes changed files; acceptable for badge-sized repositories, the first limit to revisit if a large-worktree complaint arrives.
- The `scmStatus` method depends on the optional `ctx.git` service, so deployments that do not mount the seam keep a badge-free explorer without a configuration switch.
- Adding `log`, `blame`, or write operations is a seam-surface decision, not a provider escape hatch.
