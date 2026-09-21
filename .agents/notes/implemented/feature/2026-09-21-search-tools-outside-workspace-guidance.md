# Agent Note: Search tools guide absolute-path re-rooting

Status: implemented

## Problem

When a `grep` search over the session workspace returned zero matches, the result was the bare `No matches found` and every model-facing text described `path` only as defaulting to the workspace. A model that knew the code existed in a sibling repository read the miss as "not here", concluded the structured search tool could not reach the target, and fell back to shell `grep -rn` — first over an absolute path that timed out after 60 seconds, then with growing command complexity. The tool was never incapable: its `path` argument accepts an absolute path outside the workspace, and nothing said so.

## Decision

The `grep` and `glob` tools in `packages/fs/tool-fs-search` state the outside-workspace capability in three model-facing places: the `path` parameter description of both tools ("An absolute path is searched as given, including one outside the session workspace"), the `grep` tool description, and the grep system-prompt section ("Pass an absolute path to search outside the session workspace."). An empty `grep` result names an explicitly rooted search target — `No matches found in <path>` — so the model can tell a workspace-scoped miss from a genuine absence and re-root the next call instead of switching to shell commands. Without an explicit `path`, the message stays `No matches found`. The empty-result text lives in `formatGrepEmpty` in `packages/fs/tool-fs-search/src/grep.ts`; the committed catalogs and recorded-session snapshots carry the same updated schema and prompt text.

The empty-search naming applies to `grep` only. `glob`'s render path knows only the resolved display root, which is `.` for a workspace-default search, so naming it adds no information; its `path` schema description carries the same outside-workspace sentence.

Because the search tools' prompt sections sit early in the assembled prompt and lose salience over long sessions — the observed drift is a mid-session relapse into shell `grep` even when the schemas are mounted — the `tool:bash` section in `packages/shell/tool-bash/src/index.ts` repeats the instruction at the point of reaching for a shell: "Use the file and code search tools (glob, grep, lsp) when available — not bash — however long the session runs; bash is for commands no structured tool covers." The sentence is unconditional rather than scope-aware because scoped restrictions can hide the schemas without removing the independently registered bash section; "when available" keeps it truthful when a search tool is unmounted.

The canonical routing text finally makes the preference a hard rule instead of a default. `TOOL_BATCHING_TEXT` in `packages/core/system-prompt/src/index.ts` now opens its routing sentence with "Using the structured tools for file and code work is mandatory" and reserves bash: "Reach for bash only when no structured tool exists for the task (builds, git, processes), and never to find, read, search, or edit files." The prior "as the default for file and code work" and "Never use bash for finding, reading, or searching files" framed the same guidance as a preference, which a long session could override; "mandatory" and "only when no structured tool exists" close that escape and answer the user-facing requirement that bash be used solely for work no dedicated tool covers.

## Alternatives considered

**Post-hoc prompt injection on empty results.** A session-context plugin could watch for empty searches and inject a "try another root" hint. Rejected: the guidance belongs at the surfaces that define the tool's contract (schema, prompt, result), and an extra plugin adds a lifecycle for a one-sentence fact.

**Escaping the workspace root automatically.** Re-running a miss against a configured parent tree would turn every legitimate "no matches" into a slow double search and silently widen the search scope. Rejected; the model keeps root control.

**Doing nothing and relying on model training.** The observed trajectory is the counterexample: with the schema silent, the model treated the workspace miss as a tool limitation.

## Consequences

The grep/glob schema text and the grep system-prompt section cost a few dozen more tokens per request where the tools are mounted, and the pinning surfaces — `docs/tool-catalog.md`, `docs/tool-catalog.zh.md`, the recorded-session snapshots, and `originalSearchGuidance` in `packages/fs/tool-fs-search/tests/tools.spec.ts` — must move together with any future wording change. Empty `grep` results now carry one extra clause that also lands in session logs.

## Testing

`packages/fs/tool-fs-search/tests/tools.spec.ts` pins the updated grep guidance and asserts the empty-with-path message through the mocked subprocess seam; `tests/integration.spec.ts` asserts `No matches found in notes.md` through the real packaged ripgrep binary, and keeps the no-path case as bare `No matches found`. `packages/shell/tool-bash/README.md`'s Model Experience section pins the extended bash guidance sentence, and the recorded-session snapshots carry it. `packages/core/system-prompt/tests/system-prompt.spec.ts` assembles `TOOL_BATCHING_TEXT` by symbol, so the mandatory-routing rewrite needs no test edits there.
