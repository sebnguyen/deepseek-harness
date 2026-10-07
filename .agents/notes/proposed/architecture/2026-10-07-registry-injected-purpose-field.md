# Agent Note: Registry-injected `_dsh_harness_purpose` — one universal per-call reason, split at ingress, stripped at dispatch

Status: proposed

## Problem

The delta-aware snapshot design ([proposed feature note](../feature/2026-10-07-delta-aware-workspace-snapshots-and-critique-timeline.md)) renders one card per observed effect and needs one displayable reason per effect; the critique loop cites that reason as the rebuttable "why changed" header. Today the reason signal is per-family and uncovered: `bash`/`pwsh` require a `description` argument (`packages/shell/tool-bash/src/index.ts:47,100,253-260`), the delegation family carries its own `description`, sandbox escalations carry `justification` (`:273`), and `write`/`str_replace_editor` carry only a mechanical result summary (`Created file` / `Updated file`) plus `file_path` — so a universal purpose line cannot be projected without special-casing every tool, and third-party plugin mutators carry nothing at all.

Per-tool required-field migrations (a `purpose` field on each mutator schema, an extractor over legacy names, a strict/lenient policy knob) were drafted and rejected in design: they leave plugin tools this repo has never seen non-compliant forever, and they make the enforcement count equal the mutator count. A plain injected `purpose` key was drafted and rejected too: a plugin whose domain includes a `purpose` parameter (payments, audit, workflow routing) collides with the injection, and a universal injector needs a provably free key — namespacing is the proof, a plain name is a hope.

## Proposal

One registry-owned transformation pair; every other layer reads the outcome. The registry is the single owner of both ends — the model-facing schema exposure and the argument object the body receives — so compliance is universal by construction, including unknown plugin tools.

### Namespace regime

```ts
// packages/core/tools/src/purpose.ts (new module; one reserved-key constant is the whole grammar)
/** The single reserved harness-meta key injected into every exposed tool schema. */
export const PURPOSE_KEY = '_dsh_harness_purpose' as const
```

- `dsh_harness_` is a closed reserved prefix, enumerated in the `dsh-tools` README; any future harness-meta injection lives inside it.

### Injection at schema exposure

`schemas()` whitelists only `name`/`description`/`parameters` for the model (`packages/core/tools/src/index.ts:243-244`), so injecting into the registered parameter schema is sufficient: the model sees the field on every tool without any tool's own declaration changing.

```ts
// packages/core/tools/src/purpose.ts
export function withPurpose(parameters: JsonSchemaNode): JsonSchemaNode {
  if (isJsonObject(parameters.properties) && Object.hasOwn(parameters.properties, PURPOSE_KEY))
    throw new ToolsError(`schema declares reserved key ${PURPOSE_KEY}`, 'TOOL_RESERVED_KEY')
  return {
    ...parameters,
    properties: {
      ...(isObject(parameters.properties) ? parameters.properties : {}),
      [PURPOSE_KEY]: {
        type: 'string',
        description: 'One sentence stating why this exact call is being made; it is shown to the human reviewing this session and cited in critiques of the change it produces.',
      },
    },
    required: [...(isStringArray(parameters.required) ? parameters.required : []), PURPOSE_KEY],
  }
}
```

### Cache-stable exposure

Provider prompt caches key over the tool block bytes, so the exposure must be deterministic within a build and across same-build sessions:

- Injection runs once at registration into a frozen schema object; `schemas()` (`packages/core/tools/src/index.ts:1224`) serializes that object verbatim and never mutates it during assembly, so the exposure bytes are identical at every turn, every session, and every HMR reload of the same build.

### Log keeps raw; strip is a dispatch-time view

Append-only has two readings and the corrected design satisfies both: no committed event is ever mutated (mechanical), and the log records what the model produced, byte-faithful (recorder). The first draft stripped the key before `appendToolCall`, which kept the mechanics but broke the recorder reading behind "the raw JSON string exactly as the model produced it (unparsed)" (`packages/core/session/src/types.ts:370`): byte-identical replay, prompt-cache prefixes across resume, and argument normalizers all stand on that promise. Corrected invariant:

- **Log:** `tool/call.arguments` = the raw block, verbatim; sibling optional `purpose` = a pure derivation computed once at ingress (an index for projections; the raw string stays canonical).

```ts
// packages/core/tools/src/purpose.ts
export interface PurposeDerivation { readonly cleanArguments: unknown; readonly purpose: string | null }
/** Pure derivation of the clean/dispatch view and the display purpose from a raw block. Never rewrites the raw string. */
export function derivePurpose(rawArguments: string): PurposeDerivation {
  const parsed = losslessParse(rawArguments)             // existing lossless-JSON path
  if (!isJsonObject(parsed) || typeof parsed[PURPOSE_KEY] !== 'string' || parsed[PURPOSE_KEY] === '')
    return { cleanArguments: parsed, purpose: null }    // absent or empty: no strip, fall back
  const { [PURPOSE_KEY]: purpose, ...clean } = parsed
  return { cleanArguments: clean, purpose }
}
```

```ts
// packages/core/agent-loop/src/tool-calls.ts — raw preserved, purpose sibling appended
const { purpose } = derivePurpose(block.arguments)
session.append('tool/call', {
  turn, step, callId: block.id, name: block.name, arguments: block.arguments,
  ...purpose !== null ? { purpose } : {},
})
// scheduler, at materialization: exec.arguments = derivePurpose(block.arguments).cleanArguments
```

#### Why the strip/execute path owes no events

One call has exactly two durable facts: `tool/call` (raw) and `tool/result` (content produced from the clean view, in the original run and on any resume). The strip is a pure derivation over the first; the body executes from that view and its consequences flow into the second and the checkpoint rows. Append-only binds events — appended events are never mutated or removed — not in-memory views: internal views are computation, not history, and logging them would record computation as history. The invariants ask only that every model-visible and every durable fact re-derives from events: the model's context reconstructs byte-identically from the raw `arguments` string, and the clean view recomputes through one total function in any build, at any time.

#### The unsafe direction

Re-attaching a stripped field at resume is required only by a log that stored clean args. raw → clean is information-losing and version-proof: `derivePurpose` deletes a named key and can never change answer across builds. clean → raw is information-adding: it must invent key order, whitespace, and the injected description text, so a later build republishing different schema prose would fabricate at replay time a block the model never emitted — byte-identical replay and prompt-cache prefixes both die. Re-append at replay makes the serializer part of the historical record; that is the design that violates the append-only spirit. The design therefore has no re-append anywhere: the log's raw string is the font, model-facing reconstruction is the raw string verbatim, and bodies and guards derive clean. The sibling `purpose` field on `tool/call` is admissible precisely because it is the safe direction — an additive index recomputable from raw at any time, never a repair the log depends on.

Why the strip must precede the body, universally: the MCP bridge forwards `exec.arguments` verbatim into the remote `tools/call` (`packages/mcp/mcp-client/src/tools.ts:81-89`; the loop passes the parsed model arguments, `:325-330`), so any harness key left in dispatch args reaches arbitrary third-party servers whose strict schemas (zod `.strict()`, `additionalProperties: false`) would reject the call outright — tolerant servers would silently ignore it, but a silent ignore is still a contract smell. Stripping in-process keeps every remote schema untouched; the exposed copy is the only place injection lands, so a remote server neither sees nor validates the key. Replay is byte-faithful by construction: `arguments` was never rewritten, so model-visible ⟺ logged holds at the byte level, and the sibling `purpose` is recomputable from it at any time. The `types.ts:370` JSDoc stands as written; the `tool/call` event JSDoc gains the sibling field; `docs/architecture.md` is updated for the loop touch per the repository rule.

### Wire and reader tolerance — no format bump

Adding an optional field to the `tool/call` payload requires no `SESSION_FORMAT_VERSION` bump, and this is now evidenced rather than assumed: the SDK client's `validatedSessionEvent` passes wire envelopes through untouched except the `assistant/message` and `turn/end` shapes (`packages/sdk/client/src/api.ts:264-286`); the JSONL store performs no per-type payload validation (`packages/session/session-persistence-jsonl/src/storage.ts` has no payload shape checks); and the current-format design records that same-version restoration applies the installed known-event set with a codec neutral to payload additions ([session log versioning note](../../implemented/architecture/2026-08-10-session-log-version-mechanism.md) Consequences). Any strict generation-reader check discovered during implementation would reclassify this as a core-semantics change needing the 3→4 bump with an identity adjoint edge — in that case the bump lands inside the same PR, since `appendToolCall` is already being touched; `gen-persistence-catalog` and `gen-cordis-catalog` regenerate either way.

### Presentation mapping

`purpose?: string` is added to `GenericCallView`, `TerminalCallView`, and `DiffCallView` (`packages/core/tools/src/presentation.ts:53,84,110`), and the projector fills it from a fixed precedence: retained `tool/call.purpose` first; then declared intent fields selected per known tool (`bash`/`pwsh`/delegation `description`, escalation `justification`); then the adjacent assistant text with a "no stated purpose" badge. `TerminalCallView.description` and `GenericCallView.title` keep their tool-owned semantics — purpose is a distinct line, never replacing them. The result-side join is by `callId`, never by duplication: `tool/result` stores only the model-facing `message`, optional failure identity, and the tool-private `meta` (`packages/core/session/src/types.ts:382-389`) — arguments are never re-stored, they live exactly once, raw, on `tool/call`. Args-derived display on the completed card comes from joins: `output.render(args, value)` / `presentationMeta` (`packages/core/tools/src/index.ts:204-210`) receive args from the call side, and every `ToolResultView` variant carries `title?` meaning "omit to keep the pending-state title" (`packages/core/tools/src/presentation.ts:148-149,166,186`), so the completed card keeps its args-derived title by default. The purpose line on the completed card reads `tool/call.purpose` through that same join, so nothing is appended at result time; the tool body never saw the key and therefore can never leak it into result content, and `finalizeContent`'s exec is the stripped one (`index.ts:239`).

Synthetic aborted/skipped results (`appendSkippedToolCall`, `tool-calls.ts:250`) inherit the block's split purpose when present and the badge otherwise; `run_code` sub-dispatches, workflow worker dispatches, and parentless synthetic results inherit the parent call's purpose with an "inherited" marker. Missing purpose never denies a call: degradation is a badge, not a refusal, so an old client or plugin build degrades softly at upgrade.

### Effort budget for this subsystem

Estimates are source-plus-test lines; the per-file 100% coverage gate (`pnpm run test:coverage`) makes suites proportion all new branches, so doubled test weight is the baseline assumption. Testing follows [docs/testing.md](../../../../docs/testing.md): bridge-tool-call tests over `makeBridgeHarness()` (`packages/acp/acp/tests/harness.ts`) with the real registry behind a scripted `MockAdapter`, a scripted `tool_use` block carrying the injected key, plus a REAL-composition profile smoke for the registry-injection surface.

| component | src ≈ | tests ≈ | refreshes in the same PR | days |

Subsystem total ≈ 4–5 focused days. Whole-feature budget, cross-referenced from the [snapshot note](../feature/2026-10-07-delta-aware-workspace-snapshots-and-critique-timeline.md) assembly order and inclusive of this subsystem, REAL-composition tests, and gate cycles: PR1 capture core 3–5, PR2 events/projection 1–2, PR3 restore + zoom UI 2–3, PR4 git provider 2, PR5 client surfaces 4–6 — roughly 16–23 focused days end to end, with the capture core and the client plane as the two long poles.

## Alternatives considered

- **Plain `purpose` key** — collides with any domain tool that owns the name; a universal injector must not ship a possibly-colliding key.

## Acceptance criteria

Registering a tool whose declared schema contains `_dsh_harness_purpose` or any `_dsh_harness_*` key throws at load, which also makes injection idempotent (`withPurpose(withPurpose(x))` re-trips the same check). `withPurpose` output exposes the key as required to the model on every registered tool, proven against a snapshot of `schemas()`. A test mutator that echoes `Object.keys(exec.arguments)` never observes the key. A body returning its received arguments never leaks the key into model-visible content. Replayed sessions reconstruct purpose lines byte-identically from the log alone, and `tool/call.arguments` in a recorded session is byte-identical to the block the model emitted. Absent or empty key renders the "no stated purpose" fallback, never a refusal. The format decision cites its evidence (this note) at implementation time. Python and TypeScript SDK expected outputs and every touched snapshot owner refresh in the same change; `pnpm run test:coverage` and `pnpm run doc-sync` green.

## Risks

Required-field output tokens on every call are the standing price; the field exists because every timeline card displays a reason, so the spend is proportional to the surface it feeds. Requiredness does not manufacture sincerity — "update file" passes and stays rebuttable; the loop needs a targetable line, not a good one. The log retains `arguments` raw, so byte-diffing normalizers and exact-replay fixtures see no change to that field; the residual fixture churn is the additive `purpose` sibling across expected outputs, refreshed in the same PR. The description text must name the human reviewer, not interface chrome, per the model-facing vocabulary rule. Cached model-provider prompt schemas built pre-injection will see a shape change on deploy: cold caches, documented operational noise.
