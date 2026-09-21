# Agent Note: Search tools guide absolute-path re-rooting

Status: implemented

## Problem

When `grep` searched in the session workspace and returned zero matches, the result was only the bare `No matches found`, and all model-facing text described `path` as defaulting to the workspace. A model that knew the target code was in a sibling repository interpreted the miss as "not here", determined the structured search tool could not reach that location, and fell back to shell `grep -rn` — first with an absolute path that timed out after 60 seconds, then with increasingly complex commands. The tool was never incapable: its `path` argument accepts an absolute path outside the workspace, just nothing said so.

## Decision

The `grep` and `glob` tools in `packages/fs/tool-fs-search` state the capability in three model-facing places: the `path` parameter descriptions of both tools ("An absolute path is searched as given, including one outside the session workspace."), the `grep` tool description, and the grep section of the system prompt ("Pass an absolute path to search outside the session workspace."). An empty `grep` result with an explicitly passed path names that path — `No matches found in <path>` — so the model can distinguish "not found within workspace scope" from "genuinely does not exist" and reroot the next call, rather than switching to shell commands. The empty-result text lives in `formatGrepEmpty` in `packages/fs/tool-fs-search/src/grep.ts`; the committed catalogs and recorded-session snapshots carry the same updated schema and prompt text.

The empty-result naming applies to `grep` only. `glob`'s rendering path only knows the resolved display root, which is `.` for a workspace default search, so naming it adds no information; its `path` schema description carries the same out-of-workspace sentence.

## Alternatives considered

**Injecting a hint after the fact.** A session context plugin could inject a "try another root" hint after an empty search. Rejected: this guidance belongs at the surfaces that define the tool's contract (schema, prompt, result); an extra plugin only adds lifecycle overhead for a single-sentence fact.

**Automatically escaping the workspace root.** Automatically re-running a miss against a configured parent directory would turn every legitimate miss into a slow double search and silently widen the search scope. Rejected; the model keeps control of the root.

**Not changing it, relying on the model's prior knowledge.** The observed session trajectory is the counterexample: with the schema silent, the model treated a workspace miss as a tool capability limitation.

## Consequences

Where these tools are mounted, the grep/glob schema text and the grep system prompt section cost a few dozen more tokens per request, and the pinned surfaces — `docs/tool-catalog.md`, `docs/tool-catalog.zh.md`, the recorded-session snapshots, and `originalSearchGuidance` in `packages/fs/tool-fs-search/tests/tools.spec.ts` — must change in sync with any future wording changes. Empty `grep` results carry one extra clause, which also lands in the session log.

## Testing

`packages/fs/tool-fs-search/tests/tools.spec.ts` pins the updated grep guidance and, through the mocked subprocess seam, asserts the empty-result message with a path; `tests/integration.spec.ts` asserts `No matches found in notes.md` through the real packaged ripgrep binary, and keeps the case without a path as the bare `No matches found`.
