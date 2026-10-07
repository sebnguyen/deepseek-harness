# Agent Note: Workspace snapshot timeline — captured effect rows, per-call purpose, and the Files view

Status: implemented

## Problem

The session log records what a model *asked for* and what a tool *returned*, but nothing records what the workspace became. A `write` leaves a best-effort pre-image inside its own result metadata, a `bash` call leaves nothing, and no session-facing surface can answer "what did this call change, and why" or put a file back.

Two consequences followed. A reader had no per-effect file history to review, and the reason a call ran was per-family and partial: `bash`/`pwsh` carry a `description`, delegation carries its own, escalations carry `justification`, and mutating file tools carry only a mechanical "Created file" summary — so no universal reason line could be projected without special-casing every tool, and third-party plugin mutators carried nothing at all.

## Decision

### One registry-owned purpose field, split at ingress

`packages/core/tools/src/purpose.ts` owns the reserved key `_dsh_harness_purpose` and the reserved prefix `_dsh_harness_`. The registry is the single owner of both ends of a call, so compliance is universal by construction:

- `schemaOf` projects every tool's exposed parameters with the reserved property appended **last**, so the model-facing schema is a detached projection whose source key order is preserved and whose bytes are stable across requests. Injection is unconditional and never added to `required`: the field is an offer, never a denial gate.
- `prepareExecution` splits the parsed arguments: the body receives the derived **clean** object, and the execution carries `purpose` as a sibling.
- `register` rejects a tool that declares its own reserved key, which makes injection idempotent and keeps the namespace provable.
- `packages/core/agent-loop/src/tool-calls.ts` appends `tool/call` with `arguments` **byte-verbatim** as received and adds the derived `purpose` sibling beside it, so replay reconstructs the exact bytes the model sent and the reason stays an index derived from them.

Raw fidelity is the constraint that chose this shape: `tool/call.arguments` is the append-only record and may not be rewritten, and re-appending a cleaned object would corrupt replay and prompt-cache prefixes.

### Capture as a dispatch bracket over a content-addressed store

`packages/fs/checkpoint` mounts a `tools/execute` waterfall listener that awaits `next()` and then rescans the session's resolved workspace root: a pruned stat walk (`.git`, `node_modules`, `.dsh`, a partial `.gitignore` reader, configurable extra prunes), a stat diff against the previous walk, and a read-and-digest of only the added or changed paths. Each observed change becomes one `CheckpointRow` carrying `path`, `callId`, `toolName`, the stated `purpose`, and the `before`/`after` content digests; rows accumulate into one `checkpoint/scan` session event per call, appended only when something changed.

Content lives beside the log, not in it: a per-session content-addressed store under `<dshHome>/checkpoints/v1/<sessionId>/objects/<xx>/<hex>` (0700 directories, 0600 files, stat-only idempotent puts) plus a `frontier.json` mapping path to digest. The frontier is what keeps `before` truthful when a process resumes a session without rereading the log. Capture is observation, never policy: a failed walk or write degrades to no event and never fails the call it observed.

### Read and restore surfaces

The service exposes `blob(session, digest)` and `restore(session, path, digest)` over Typert, sharing one write path with a model-facing `checkpoint_restore` tool. Restores go through `ctx.fs`, so the session's sandbox policy governs them exactly as it governs a file tool.

### The Files view

`packages/client/ui-file-history` registers one conversation view. It folds the session binding's own event window into per-file stop lists — memoized per window revision — and joins each row to its `tool/call` event by `callId` to recover turn, step, and purpose. The panel lists the changed files, scrubs a slider across one file's stops, zooms between per-call and per-turn granularity (a turn keeps its last stop), renders the stop's diff through the shared `DiffBlock` primitive, and restores a stop through the Remote. Copy is locale-owned in the `fileHistory` namespace; content is fetched per displayed stop, so the view holds only what it shows.

## Alternatives considered

- **A `purpose` parameter on each mutator schema** — leaves unknown plugin tools non-compliant forever and makes the enforcement count equal to the mutator count.
- **A plain (unnamespaced) injected key** — collides with any plugin whose domain legitimately includes that name; the reserved prefix is the proof that the key is free.
- **Appending `checkpoint/scan` rows that repeat turn and step** — the registry's execution view has no turn/step, and duplicating them would let the row and the call drift; the client joins instead.
- **Serving rows from the service over Remote** — rows already ride the session log, so a Remote read would be a second source of truth for the same data; only the bytes need a Remote.
- **Keeping pre-images in `tool/result`** — the existing `FsWriteOutcome.before` path only covers file tools and holds no terminal writes.

## Verification

- `pnpm exec vitest run packages/core/tools` — 401 passed, including `purpose.spec.ts` (squat rejection, last-position injection, clean body arguments, `purpose` sibling).
- `pnpm exec vitest run packages/core/agent-loop` — 414 passed, including the purpose-line case asserting byte-identical `arguments` and the body seeing clean keys.
- `pnpm exec vitest run packages/fs/checkpoint packages/client/ui-file-history` — 34 passed: row attribution and digest chaining, removal rows, untouched and agentless calls, disabled capture, frontier continuity across a fresh process, blob/restore through both surfaces, plugin disposal, the fold and turn zoom, and the panel's stop selection, diff, and restore.
- `pnpm run build:lib:host` and `pnpm exec tsc -b tsconfig.client.json` — both faces clean; the generated Remote client types are `blob`/`restore` over `SessionId`.
- Catalogs and gates: `gen-persistence-catalog` (registers `checkpoint/scan` in `KNOWN_SESSION_EVENT_TYPES`), `gen-session-format-catalog`, `gen-config-catalog`, `gen-cordis-catalog`, `gen-client-catalog`, `gen-cordis-inspect-catalog`, `gen-tsconfig-paths` all regenerate and their `verify-*` counterparts pass.
- Pre-existing failures on this branch's base, unrelated to this change and untouched by it: `verify-export-jsdoc` (knowledge-notes, subagent step-budget, llm-replay), `verify-package-dependencies` (ui-editor), `verify-package-readme-summaries` / `-model-experience` / `-limitations` (guard, knowledge-notes, lsp, shell-search, skill-context), `verify-client-ui-i18n` (ui-trajectory `[image]`/`[file]`).

## Consequences

- The session format does not change: `checkpoint/scan` is a new `SessionEventMap` member under the ordinary-addition path (declaration merging, JSON-serializable payload, no `SESSION_FORMAT_VERSION` bump), and the `tool/call` payload gains one optional sibling field.
- A workspace timeline is reviewable and restorable per stop, for every mutator including terminal writes that never went through a file tool.
- Attribution is deliberately post-hoc: a change made outside a tool call lands on the next call. Capture sees effects, not authors, and no row claims a cause the harness never observed.
- Content is text-only; a file that cannot be read as text is recorded by digest with no retained bytes, and nothing prunes objects yet.
- The restore tool ships from the service package rather than a `packages/*/tool-*` package, so it is outside the generated tool catalog's declared scope and documented by its package README instead.
- Still open, with the design notes left in `proposed/`: the critique/rebuttal wire that makes the purpose line rebuttable, prompt-composition rendering per request, and the dynamic-path provider.
