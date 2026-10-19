# Strict purpose contract: required at dispatch, stripped at the execution handoff

**Implemented:** 2026-10-14
**Scope:** `packages/core/tools` (schema + registry dispatch), `packages/test-support/llm-replay`, `packages/test-support/session-snapshot`, every per-tool test suite
**Note history:** extends ([proposed] ../proposed/architecture/2026-10-07-registry-injected-purpose-field.md)

## Problem

`_dsh_harness_purpose` was exposed to models as `required` in every tool schema, `derivePurpose` stripped it prior to validation, and nothing enforced its presence — calls without purpose executed silently. The injected description compounded the story by calling the field "Optional", so models followed the description, never the schema. The critique timeline, which needs one displayable reason per effect, received blank purposes in the general case.

## Decision

Strict on emission, stripped on execution.

1. **Enforced required at dispatch.** `ToolRuntime`'s execution boundary rejects a call whose parsed arguments carry no non-empty string under `PURPOSE_KEY` (`description`; see [the shared description purpose key](./2026-10-14-shared-description-purpose-key.md)), through the standard invalid-args result (`Error: invalid arguments: missing required property "description" — …`), so model recovery loops learn it the way they learned the flat batch shapes.
2. **Stripped on the same handoff.** `derivePurpose` still lifts the key before guards, approval, bodies, and MCP forwarding; enforcement reads the raw detached block, and bodies never see it. The description text now says "Required on every call".
3. **Replay stamps the contract.** The snapshot replay adapter impersonates models; prerecorded args gain the marker purpose `snapshot replay of a model turn recorded before the purpose contract` at emission, only when absent.
4. **Normalization projects the key out.** Snapshot comparisons keep the stripped view (walker drops the key, `tool/call.purpose` sibling dropped, stringified `arguments` parsed/stripped/re-serialized), so prerecorded fixtures stay comparable without rewriting history.
5. **Shape coercion stays strict.** `defineTool` gained a `normalizeArgs` pre-validation hook whose charter is shape coercion only — the three batch tools (`multi_bash`, `multi_read`, `multi_write`) use one shared `wrapSingletonArgs` to fold a remembered singleton root (`{command: …}`, `{file_path: …}`) into one element. Type mismatches — stringified containers included — still fail validation outright; the rejected salvage proposal stays rejected.

## Consequences

- Every test suite that executes tools directly or mocks LLM emissions now carries the key in its fixtures (repo-wide sweep, one line per shared `call()` helper).
- `PURPOSE_DESCRIPTION` no longer contradicts the schema; new models see one contract: emit it on every call.
- No session-format bump: `tool/call.purpose` was already tolerant at wire bounds, and the compare-side projection lives in `dsh-session-snapshot`, not the runtime.
- Legacy singleton callers keep failing with the strict batch-shape error only when they present a shape the wrapper cannot recognize (e.g. `commands` as a string), which is the shape the strict error grammar teaches directly.
- Follow-up residue from the same session: batch element caps (`maxCommandsPerCall`, `maxFilesPerCall`) were removed; batch schemas accept `1..∞` elements.
