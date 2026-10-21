# Agent Note: Multi-session terminal profile over the in-process composition

Status: proposed

## Problem

The Web composition (`dsh --profile web`) is the only surface that lists and switches between Sessions in one process, and that capability arrives bundled with costs a terminal operator does not use: a Chromium-scale runtime, an HTTP gateway, the browser plugin roster, and the VS Code twin spawner (`packages/bundle/web-app/cordis.patch.yml`).

The terminal profile (`dsh --profile tui`, `packages/bundle/tui-app`) proves the opposite trade: an in-process tree over `dsh-base` with no Host rows, streaming `session/event` and `agent/assistant-stream` into the terminal with inline approvals and slash commands — but it composes exactly one Session per invocation. Switching Sessions means exiting the process; there is no session list at all.

An operator on a plain tty (SSH, server console) today chooses between browser-grade Session management and terminal weight. Nothing in that gap is enforced by the architecture: the session list Remote (`packages/api/session-controller`), the activity push events (`packages/api/session-controller/src/remote-events.ts`), and the stream `follow` RPC all serve one composition either way. Only the presentation surface is missing.

## Proposal

Ship a new shipped profile `tui-multi` and its bundle `@deepseek-ai/dsh-tui-multi-app`, plus a small `packages/tui/` package group rendering Session list and chat through OpenTUI's React reconciler (`@opentui/react`, native Zig core, Yoga layout).

### Composition layer

```
profiles:   add `tui-multi: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-tui-multi-app'], patchReload: 'startup' }`
            in PROFILE_TEMPLATES (packages/boot/app-boot/src/profile.ts)
```

The bundle's `cordis.patch.yml` mirrors `dsh-tui-app`'s shape (`packages/bundle/tui-app/cordis.patch.yml`): restate `system-prompt` persona values, keep the `DSH_TOOLS_MODE` env seam on `tools`, and insert only host rows this surface owns:

```yaml
- insert:
    - id: code-runtime
      name: '@deepseek-ai/dsh-code-runtime-worker-thread'

    - id: tui-multi-startup
      name: '@deepseek-ai/dsh-tui-multi-app/startup'     # cmdlineArgs seat

    - id: tui-multi-runner
      name: '@deepseek-ai/dsh-tui-multi-app'
      inject: [tuiMultiStartup]
      config:
        color: !!js ctx.tuiMultiStartup.color
        scrollbackLimit: 5000                      # Config field, never a constant
        streamFrameMs: 33                          # max transcript frame cadence
```

No `webserver`, `web-runtime`, `connection`, `modules` (browser), `ide`, or `vscode-*` row is inserted, and no `dsh.client` row exists in this composition — the Web roster is excluded by construction because the bundle's patch is its own file, not an overlay of `dsh-web-app`.

### Package layout (`packages/tui/`, the `tui_modules` group)

The Web client keeps its kernel (`packages/client/web`) and feature packages (`packages/client/ui-*`) as separate workspaces scanned through the `dsh.client` declaration kind (`dsh-client-modules`). This proposal mirrors that topology at terminal scale — one boot kernel, one module registry, four feature packages — so a future third TUI pane joins by adding a row, not by editing the runner:

```
packages/tui/
  tui/                @deepseek-ai/dsh-tui            boot kernel; entry src/tui/index.ts;
                                                      mounts the @opentui/react root, owns
                                                      focus model and pane layout
  modules/            @deepseek-ai/dsh-tui-modules    scans loader rows carrying the new
                                                      dsh.tui declaration kind; provides the
                                                      ordered module table to the kernel
  session-list/       @deepseek-ai/dsh-tui-session-list   table pane over session.list,
                                                      refreshed by api-session/* pushes
  transcript/         @deepseek-ai/dsh-tui-transcript chat pane; folds stream deltas to frames
  composer/           @deepseek-ai/dsh-tui-composer   prompt textarea submitting prompt(); owns slash commands
  approval/           @deepseek-ai/dsh-tui-approval   inline approval/request decision component
```

`dsh.tui` is a new declaration kind; the loader allowlist gains one string, mirroring how `dsh.client` and `dsh.vscode` already gate their rosters.

### Data surfaces (existing, no server change)

- Session list: `ctx.remote.session.list` / `.page` / `.search` (`packages/api/session-controller/src/index.ts`, registered `list` at the controller's Remote assembly), live-refreshed on the `api-session/added|removed|status|activity` push names.
- Transcript: in-process `ctx.on('session/event')` for committed events plus `ctx.on('agent/assistant-stream')` for deltas, following `dsh-tui-app`'s existing subscriptions (`packages/bundle/tui-app/src/index.ts`); over Remote, `follow` supplies the opening snapshot plus gap-free frames and `SessionAssistantStreamAccumulator` (`packages/api/session-controller/src/assistant-stream.ts`) is the folding precedent.
- Mutation: prompts, cancels, renames call the Session.Remote methods; components hold no engine references.
- Approvals: `approval/request` events, rendered inline in the transcript pane without stealing composer focus until keyboard-selected.

All rendering derives from event-driven state; the kernel never polls.

## Alternatives considered

**Extend `dsh-tui-app` with a list mode behind a flag.** Rejected: the `tui` template's contract is one-process-one-session for scriptable invocations, and its composable (`tui-app/cordis.patch.yml`) declares no session-switch vocabulary. Folding both behaviors into one template couples the stable single-session path to a new layout engine for every existing user, which the shipped-profile stability rule disallow.

**Keep Ink (existing renderer) instead of OpenTUI.** Rejected: Ink works and `tui-app` proves it, but it provides no scrollable viewport, no textarea primitive, and re-renders the component tree per update under burst load — the exact failure the four-pane multi-session shell would hit first. OpenTUI supplies `<scrollbox>`, `<textarea>`, and a native buffer renderer; the React reconciler keeps state and effect code portable from the Web client's component model. This is the proposal's largest reversible dependency decision.

**Build an out-of-repo ACP client TUI.** Rejected: the ACP bridge (`packages/acp/acp`) exposes `session.list` and `session.prompt` over a wire, but the operator surface belongs to the shipped composition: it should consume presets, approvals, and session projections from the same in-process tree it manages rather than re-specifying those semantics over stdio.

## Acceptance criteria

1. `dsh --profile tui-multi` boots to the two-pane shell (session list + transcript + composer) with zero Web-bundle rows mounted; a boot assertion over the loader inventory proves the composition carries no `dsh.client` declaration.
2. The list pane reflects `api-session/*` pushes without a repaint of the transcript; selecting a row follows that Session through the `follow` stream from its opening snapshot.
3. A 1k-frame assistant burst renders at the configured frame cadence with zero committed `session/event` losses (folding test against a recorded stream).
4. An `approval/request` resolves from the keyboard without focus leaving the transcript until decision.
5. `dsh --profile tui` and `dsh --profile web` compose and replay unchanged; their snapshot suites pass without fixture edits.

## Risks

- **OpenTUI runtime distribution.** The Zig core ships per-platform binaries; the engines matrix (Node ^22.19 || >=24, Linux/macOS/Windows) must be covered before merge or the profile refuses at load with an actionable error. Failure mode: a new native dependency the repo has not previously vendored.
- **Scrollback memory.** A bounded scrollbox (`scrollbackLimit`) plus `.page` paging replaces the Web's unbounded DOM; long Sessions will hide early turns by design, changed surface behavior operators must see documented.
- **New `dsh.tui` declaration kind is public vocabulary.** Verifier allowlists and the rescope manifest absorb it, but its syntax becomes preview-stable on merge and costly to rename later; the four initial packages are the proof it generalizes.
- **Terminal rendering has no snapshot harness today.** Multi-session replay coverage needs a headless renderer capture seam; building that seam is part of this work, not a follow-up, or criteria 3 and 5 cannot be verified in CI.
