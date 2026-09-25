# Agent Note: Structure Your Search replaces Standard Harness Tools, and shipped presets stop mounting glob and grep

Status: implemented

## Problem

The order-40 core rule allocated tool choice: "discovery belongs to glob, grep, symbols, lsp, and read" and "changes belong to write, edit". Three failures followed from stating a catalog fact in the one prompt section that cannot check the catalog.

First, the rule could lie. Every per-tool `Advice:` section self-suppresses against the live scope (`ctx.tools.get('grep', scope) === undefined ? '' : adviceLine(...)`), but a built-in core section is assembled before any scope is known, so a `ptc`, `minimal`, or restricted scope read about tools it did not have.

Second, the routing sentence competed with shell habits and lost. A recorded observation in [search tools guide absolute-path re-rooting](2026-09-21-search-tools-outside-workspace-guidance.md) already described the failure — "the observed drift is a mid-session relapse into shell `grep` even when the schemas are mounted" — and its mitigation was repetition at the point of use, which the rationale-led rewrite then removed on the grounds that reasons would carry the preference.

Third, the sentence bought nothing measurable. Nothing in the repository measures tool-choice rate, so each iteration of routing prose was an opinion; three consecutive historical formulations ("Never use bash for finding, reading, or searching files", then "Using the structured tools for file and code work is mandatory", then a rationale) changed the text without evidence that any of them changed behavior.

## Decision

The rule becomes **Core Rule: Structure Your Search** — `harness:core-rule:structure-your-search`, order 40, renamed from `harness:core-rule:standard-tools` / `CORE_RULE_STANDARD_TOOLS`. It states a method rather than a catalog: symbols, callers, and callees first where a language server covers the file, then the returned range, then a numbered text search; text search reaches what a symbol index cannot (configuration, generated files, fixtures, docs, and every place that names a symbol as a string); listings are bounded and reads are numbered so cited offsets can be checked. It names no search or discovery tool, so it is true in a shell-only scope.

Three sibling rules that named the unmounted pair were reworded the same way, keeping their subjects and triggers: Context Over Inference ("list the candidates, outline the structure, search for definitions and usages"), Action Over Thinking ("a read, a search, or a short test run"), and Batch Over Individual ("Batch independent read-only work first — lookups, searches, and reads").

`read` stays mounted and is the only survivor of the fs-search family that the loop depends on: `fs-observation-policy` derives the write and edit preconditions from per-session presence-and-version observations, and the sole producers of a present observation are the fs tools themselves (`packages/fs/tool-fs/src/read.ts`, `write.ts`, `edit.ts`). A shell `cat` emits none, so unmounting `read` would make `editIntent` throw `FS_NOT_OBSERVED` for every existing file.

`glob` and `grep` are unmounted from every shipped composition — the base bundle, the web-app override, and the `standard`, `cordis`, and `ptc` presets. `dsh-tool-fs-search` stays a workspace package with its tests, caps, spill artifacts, and sampling behavior; scenario-local compositions that pin that behavior (`snapshots/session/fs-glob-sampling`) keep mounting it.

## Alternatives considered

**Keep the rule and unmount nothing.** Rejected: the rule is the only prompt text that can name a scope's absent tools, and the drift it was supposed to prevent is what the recorded observation documents.

**Unmount `read` with the search pair.** Rejected for the observation-policy reason above; without `read` the harness has no no-clobber guarantee, and every edit to an existing file fails.

**Reword the rule and keep `grep`/`glob` mounted.** Rejected as half the change: the rule's examples and the sibling rules still named tools a shell-only scope would not have, and the catalog kept paying schema tokens for guidance the model did not follow. Measured cost of the pair in the `text-turn` catalog is 1035 bytes (`glob`) plus 936 (`grep`) of 28 925 total schema bytes.

**Route the preference through a guard instead** (a `tools/post-execute` notice when shell search runs where a mounted counterpart exists, the `repeat-tool-reminder` pattern). Deferred, not rejected: it is the only lever with a consequence at the point of use, and it becomes measurable once a routing metric exists.

## Consequences

Core prompt guidance shrinks from 7655 to 7578 characters: the replaced rule is 755 against 820, and the three reworded siblings ratchet to 477, 866, and 585. `system-prompt.spec.ts` records those ceilings and the aggregate.

Model-visible change: the order-40 section name, label, and text; the three sibling texts; the disappearance of the `tool:glob` and `tool:grep` sections, which self-suppress once their tools leave the catalog. A shipped session's catalog has no `glob` or `grep`, so text search runs through the shell, and the `read` tool remains the numbered, observation-recording path.

Fixture surface refreshed in the same change: 39 `system-prompt.expected.md` and 39 `tool-schemas*.json` sidecars under `snapshots/`, the oracle page `docs/subsystems/core-prompt-guidance.md` with its Chinese pair, the shipped-catalog assertion in `apps/web/tests/shipped-composition.e2e.ts`, and the generated composition graphs.

This supersedes the "the rule names … stay" clause of [rationale-led core prompt guidance](../../../../.agents/notes/implemented/architecture/2026-09-24-rationale-led-prompt-guidance.md): the reasons stay, the catalog allocation does not.

Unmeasured: whether shell search reduces citation accuracy in practice, and how much of the routing prose's removal changes tool choice. Both need the routing metric described in this session's design discussion, over `request/header.tools` plus each step's `tool/call` names.
