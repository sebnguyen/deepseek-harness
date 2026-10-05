# Agent Note: Web editor M1 — guarded human saves over the workspace-files seam

Status: implemented

## Problem

The web client could observe but never modify a workspace: the `workspaceFiles` Remote namespace exposed reads only, and the right Sidebar held no editable surface. The product goal ([editor foundation](../../proposed/architecture/2026-10-05-web-workbench-editor-foundation.md)) asks for a VS Code-class editor whose first milestone is open → edit → Ctrl-S with conflict safety. The host already had every primitive a save needs — `FileSystem.writeText` with `replaceIfVersion` stale guards, `WorkspaceFileStat.version` on every read, the read-only sandbox mode — none of it reachable from the wire.

## Decision

Human saves run through one new unary `@Remote write` on the existing `workspaceFiles` namespace, not a new namespace or an agent tool call. It reuses the existing `workspaceFileScope` lookup and path resolver, applies the complete-file cap, refuses a read-only Session with `workspace-file/read-only`, and translates the backend's `FS_STALE_VERSION` into `workspace-file/stale`. The write carries a per-call `SandboxExecutionPolicy` of `danger-full-access` because the human at the wire IS the authority; the agent's `workspace-write` containment continues to bind tool writes. The client is a new package `dsh-client-ui-editor`: a `builtin`-band tab type claiming session-scoped file addresses ahead of the text preview's `fallback` band, one CodeMirror 6 view per tab loaded from `readAll`, Mod-S bound to `write` under the loaded version, a stale refusal rendering a conflict banner with reload (discard the buffer) and overwrite (save against the fresh version), and a dirty-buffer announcement when `useResource` reports a moved version. The host seams (`write`, scope lookup, error vocabulary) are engine-agnostic, so the substrate choice the foundation note records stays swappable.

## Alternatives considered

**A mutation modelled as an agent tool call.** Loses determinism, adds prompt/log surface, and makes a UI gesture depend on a loop; the save is the user's own act, not model output.

**A separate `workspaceFilesWrite` namespace or an approval-gated write.** The read namespace already carries the scope lookup and caps; splitting it duplicates the resolver. Approval for the human's own save would prompt the user for the user's own act, and read-only sessions already provide the deployment latch.

**Paged or diff-based saves.** Needed by nothing at this size; complete-file transfers match `readAll`'s existing cap, and the version guard is the whole conflict story.

**Monaco for M1.** Deferred by the foundation note; the seams fixed here are engine-agnostic, so nothing about this decision binds M2–M5 to CodeMirror.

## Consequences

`workspace-files` gains `write` plus the `workspace-file/stale` and `workspace-file/read-only` error codes, its README, its description, and one harness field (`defaultMode` on the test sandbox stub); behavior tests in `tests/write.spec.ts` cover create, versioned replace, the stale race, directory refusal, the cap, the read-only latch, and a non-version backend failure. `dsh-client-ui-editor` ships under the web-app bundle roster with its own dictionaries, coverage-gated client tests (registration disposal under jsdom, the Mod-S save contract, the conflict banner's reload and overwrite resolutions, the dirty-buffer announcement, read failures), and its package README. The `text` preview is unchanged and keeps serving read-only viewers and files the editor refuses. Reads remain non-transactional, so an unobserved external writer still races; the version guard turns its outcome into a surfaced conflict rather than a silent clobber. M2–M5 stay owned by the proposed foundation note.
