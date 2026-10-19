# Agent Note: Shared `description` purpose key — renamed from `_dsh_harness_purpose` with tool-declared dedup

Status: implemented

Scope: `packages/core/tools` (purpose module + registry), `packages/core/session` (event doc), `packages/test-support/llm-replay`, `packages/test-support/session-snapshot`, `packages/client/ui-chat`, every per-tool test suite, snapshot goldens. Extends [the strict purpose contract](./2026-10-14-strict-purpose-contract.md) and the [registry-injected purpose field proposal](../proposed/architecture/2026-10-07-registry-injected-purpose-field.md).

## Problem

The universal per-call reason lived at the reserved key `_dsh_harness_purpose`, duplicating argument families that already carried the same sentence — the shell tools' required `description` (`packages/shell/tool-bash/src/index.ts`), `run_code`'s program summary, subagent delegation descriptions. A call could carry the reason twice with nothing to reconcile the copies, and the critique timeline joined against a key models were taught in two vocabularies.

## Decision

One key, named `description`; injection dedups around declarations.

1. **PURPOSE_KEY is `description`.** `withPurpose` injects `{ type: 'string', description: PURPOSE_DESCRIPTION }` (appended last in `properties` and `required`) only into object-rooted schemas that do not declare `description`. A tool-declared `description` passes through byte-identical — injection is additive-or-unchanged, NEVER a replacement — which also makes injection idempotent by the dedup itself. `_dsh_harness_` remains a closed reserved prefix for future harness-meta injections; registrations declaring it still fail at load.
2. **Dedup-aware strip at the dispatch handoff.** The registry lifts `parsed.description` as the purpose sibling exactly as before, but strips it from the execution view only when the tool did NOT declare it: a tool-declared `description` (bash, pwsh, `run_code`) stays in dispatch args as the tool's own contract — remotely-forwarded MCP arguments are likewise untouched for declared keys and clean for injected ones. Purpose enforcement is unchanged: absent, empty, or non-string `description` fails at dispatch before policy or bodies.
3. **Replay inherits recorded purposes.** `llm-replay` still stamps the marker when a prerecorded call carries no purpose, and recordings made under the retired `_dsh_harness_purpose` key inherit their recorded value additively as `description` — the historical key stays verbatim in the args (no rewriting of history).
4. **Comparison stripping is scoped to tool-call arguments.** The normalizer no longer drops the key in the generic JSON walker (`description` is a common key with legitimate meanings elsewhere — tool schemas, message metadata); it drops the parsed `description` value only inside `tool/call` `arguments` plus the derived `purpose` sibling, so corpora recorded under either contract stay comparable.
5. **The chat UI reads `description`.** The turn-status purpose extractor matches the renamed field in raw argument text.

## Alternatives considered

- **Keep `_dsh_harness_purpose` and extract declared aliases at presentation.** The presentation layer already had the alias problem (bash `description`, escalation `justification`), and pushing the union there keeps two live contract keys forever; models fill one or the other and the critique timeline still reconciles pairs. Rejected in favor of one key tools may supply themselves.
- **Replace a tool-declared `description` with the injected one.** A uniform injected property would have made registry enforcement trivially single-sourced, but it overwrites the tool's own contract: bash's body reads its `description` for the terminal card, and `run_code`'s summary labels the program card. Rejected under the explicit additive-or-unchanged constraint.
- **Bump the session format for the rename.** The key lives inside argument strings and schema projections, not the persisted event shape; the compare-side projection in `dsh-session-snapshot` handles corpora from either contract, the same reasoning the strict-contract note applied. Rejected.

## Consequences

- Tools that declare `description` (shell, `run_code`, subagent) have exactly one `description` property and one `required` entry in their model-facing schema; every other tool gains the injected one — no schema ever carries two.
- Every shared `call()` test helper's fixture string moved from an `_dsh_harness_purpose` trailing override into a leading `description` default, so test-provided descriptions win; the duplicate-key hazard from a naive rename was the main migration hazard and is gone.
- Registry enforcement preempts tool-level validation for missing or non-string `description`: the diagnostic is the registry's `missing required property "description"` either way, matching the strict-contract note's precedence.
- Historical goldens keep `_dsh_harness_purpose` verbatim inside recorded argument strings; refreshed goldens carry whatever the new contract emits for the same recording, and comparison normalization covers both.
