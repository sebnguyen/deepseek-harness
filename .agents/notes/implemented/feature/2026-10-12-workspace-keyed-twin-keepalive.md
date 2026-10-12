# Agent Note: Workspace-keyed keep-alive float for the VS Code twin

Status: implemented

## Problem

The host twin spawner already runs ONE `code-server-oss` child per workspace root (`workspaceKey = header cwd ?? session id` in `@deepseek-ai/dsh-api-ide`), so two sessions on the same workspace poll back the same URL + token. The client inverted that: the `vscode` tab body is session-scoped and the seat contract remounts bodies on session switch, which recreated the `<iframe>` and re-booted the workbench document on every switch — visually indistinguishable from changing the workspace. A first keep-alive revision that parked the element in a host node and reparented it into each body also reloaded the workbench, because browsers reset an iframe's browsing context whenever the element changes parent — reparenting is indistinguishable from a fresh mount.

## Proposal

Never move the element. `ui-vscode`'s `keep-alive.tsx` gives each ready src (the ready triple is the workspace identity: identical URL + token + folder for every session on one root) a permanent fixed-position container appended to `document.body`, holding that workspace's iframe forever. `TwinFrameMount` stakes its box on mount: a rAF loop places the container over the box's live rect — column drags, sidebar transitions, and the panel's fullscreen band (z 45 above the fullscreen panel's 40, z 12 otherwise, under the shell overlay layer and the docked float host) all follow — and parks it hidden when the last view leaves. Consequences:

- session switch, same workspace: the float re-points at the new box; the live document, scroll, and focus survive, zero reloads;
- switch to another workspace: the first frame stays parked at `display: none`, returning restores it instantly;
- new workspace root, or a changed token/folder: one fresh frame load;
- harness restart: unchanged — the pinned port keeps the origin stable and the workbench's origin-keyed IndexedDB restores open editors and layout on load.

The cap is two frames; the least-recently-created frame no body currently shows is evicted when a new root arrives, so staked floats never lose their document. The boot hero renders as a cover portalled into the float itself, stacked over the frame until the document's `load` plus the settle margin, preserving the no-white-flash seam.

Out of scope, deliberately: persisting the per-spawn connection token would make restarts src-identical too, but it turns a process-scoped secret into a file on disk for marginal gain over the IndexedDB restore that already covers restarts; per-workspace `--user-data-dir` isolation is server-side cosmetics the browser storage already supersedes.

## Related

- `packages/client/ui-vscode/src/client/keep-alive.tsx` — the float host and pane-side stake.
- `packages/api/ide/src/index.ts` — the workspace-keyed twin registry this mirrors.
- [Embedded OSS-VS-Code editor frame](../proposed/architecture/2026-10-09-embedded-vscode-reh-editor-frame.md) — the effort this scaffold row belongs to.
