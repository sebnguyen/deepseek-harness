# Agent Note: Multi-command shell invocations — one bash/pwsh call that fans out

Status: proposed

## Problem

The dominant cost of shell-driven exploration is agent turns, not commands. A discovery step ("what fails, where, and what does the tree look like") is three to five one-line shell invocations, and models overwhelmingly emit them one per step — the same 1-thought-1-call degeneration observed across harnesses — so each cheap command pays for a full cached-context model round trip. The loop already executes multiple emitted calls in a bounded rolling pool ([parallel tool-call execution](../../implemented/feature/2026-07-10-parallel-tool-call-execution.md)), but that only parallelizes calls the model decided to emit together, and mid-task models do not emit batches: independence has to be *asserted* at emission, which is exactly the analysis the model distrusts once results start mattering. Prompt prose ("batch independent calls") is empirically insufficient because it fights that emission-time uncertainty.

The harness's other tools already solved this by putting the loop inside one invocation: `write` takes an `edits[]` array, delegation tools take `tasks[]`. A single array parameter reads to the model as one atomic, recoverable action, so it is emitted where five parallel invokes are not. The shell tools offer no such surface: `bash`/`pwsh` accept exactly one opaque `command` string, and the recovery path models fall back to — `;`/`&&`-chaining in one string — destroys the facts a model needs to reason safely: per-command exit codes collapse into the last one, per-command output becomes undecodable interleaved text, and a timeout or sandbox denial kills or obscures the whole chain. There is therefore no low-risk encoding for "run these N independent shell jobs": one invoke per job (turn-heavy) or one unstructured string (fact-lossy).

The same gap exists on Windows: `dsh-tool-pwsh` mirrors `dsh-tool-bash`'s parameter surface by contract ([pwsh tool/bash parity](../../implemented/feature/2026-08-02-pwsh-tool-bash-parity.md)), so whichever surface ships on bash must ship on pwsh in the same change.

## Proposal

Add an optional `commands` array as a second invocation face of the `bash` and `pwsh` tools, keeping the singular `command` face as an indefinitely retained sugar. One call carries up to N independent jobs; the executor runs them in submission order and returns one labeled result frame per element, so the facts a `;`-chain loses (exit code, per-command output, denial/timeout attribution, spill paths) are preserved by construction. Elements are genuine nested tool dispatches: the frames face is a composite tool — the second shipped consumer of the registry's nested-dispatch surface after `run_code` ([PTC mode](../../implemented/feature/2026-06-15-ptc.md)) — whose program is the `commands` array instead of model-written text. Each element is dispatched through the public `ToolRuntime.execute` pipeline as the same tool's singular face, carrying `parent: exec.token` of the outer execution, so pre-execute/guards/execute/post-execute/finalize run per element and permissions, sandboxing, spill, jobs, and `tools/result` notifications all keep working per element for free. Model-visible `tool/call`/`tool/result` session events are appended only by the agent loop for model-emitted calls, so nested executions are model-invisible by construction; their settle-side facts ride log-only `tool/ptc-dispatch-start`/`tool/ptc-dispatch` pairs exactly like PTC sub-dispatches, with the same `<outer>:ptc:<n>` id scheme, so the session V2→V3 PTC vocabulary, id preservation, and UI correlation apply unchanged and the parent call's args name which transport fanned out. The pair rides the current format as settled members (`SESSION_FORMAT_VERSION` 3; the V2→V3 migration renamed their predecessors), so reuse is versioning-inert; dispatch events are registry-owned engine vocabulary, not plugin vocabulary — a future plugin-authored element trace would instead ride the `ignorable: true` envelope rail, the format's sanctioned vocabulary-growth path that bumps nothing, while required-at-read admission stays reserved for structural format changes. The outer execution's `deferContext` ferries element `additionalContexts` to the outer result in dispatch order — deferContext's role is carrying nested context and plugin-sourced instructions, not the primary payload, which renders into the outer `tool/result.content` as the frames value (§Frame model) so the result card and the exit-marker contract anchor to it — and `concludeTurn` forwards exactly as the composite contract documents. The `ctx.shell` seam is untouched beneath the singular face, and recursion is structurally depth one because element schemas carry no `commands` field.

The migration is a presentation-layer migration only. Recorded session logs carry tool args verbatim, so singular calls from old sessions replay unchanged through the new schema; the frames output correlates to its call by the call id, needs no session-format bump, and no migration package.

### Schema surface

Both tools advertise, beside the current parameters:

```text
commands: array (optional), 1..maxCommandsPerCall items, each an object:
  command:    string, required — the shell command for this element
  description: string, optional — one-line UI label; falls back to the command
  workdir:    string, optional — per-element override
  timeoutMs:  number, optional — per-element override
  run_in_background: boolean, optional — advertised iff enableRunInBackground
```

The singular face (`command` plus call-level `workdir`/`timeoutMs`/`run_in_background`) stays byte-identical. The call-level `description` stays required on both faces. Sandbox escalation fields (`sandbox_permissions`/`justification`) stay call-level and apply to the whole invocation; they are refused in combination with `commands` in v1 (an escalated call classifies exclusive, §Execution). `validateBashArgs` grows the array branch: non-empty array, per-element non-empty `command`, per-element `workdir`/`timeoutMs` validated by the same helpers, `command`+`commands` presence mutually exclusive, and `maxCommandsPerCall` overflow an args error rather than a truncation.

The element's `description` is the v1 schema's existing parameter, not a minted intent field: because elements dispatch as bare singular executions, the wrapper's element-to-args assembly — the explicit `resolve(request): Spec` defaulting idiom of the owning layer — fills the singular face's required `description` from the element's own label, defaulting to the command text when omitted, and every resolved purpose rides the logged dispatch, the UI, and the dispatch events as an ordinary argument of an ordinary v1 call. No `_dsh`-prefixed model-introspection field joins either schema: no gate or snapshot requirement enforces a tool-wide intent parameter — the enforced intent surfaces are each tool's model-facing schema description ([tool authoring reference](../../../../docs/cookbook/adding-a-tool.md), schemas replay as snapshot sidecars) plus bash's required per-call `description`; any future harness-channel annotation belongs outside tool parameters in the reserved `dsh_` wire-prefix idiom ([DeepSeek wire extensions](../../../../docs/deepseek-llm-api-wire-extensions.md)).

`maxCommandsPerCall` joins each tool's validated `Config` (default 8, positive integer, rejected at load like `enableRunInBackground`), per the no-hardcoded-tunables convention; it is the deployment dial for the new face.

### The frame model and wire output

The tool's existing output `oneOf` gains one arm; the two current arms (background ack, foreground result) are untouched so singular behavior and every existing consumer of the canonical value keep validating:

```text
{ kind: 'frames', frames: [ {
    index: integer, command: string,
    outcome: oneOf[
      { kind: 'foreground', ...exact current foreground properties },
      { kind: 'job', jobId: string },
      { kind: 'not-run', reason: string } ] } ] }
```

The frames loop runs elements serially in submission order, each settling independently: a foreground element resolves with the singular face's current canonical value, so the frame embeds the existing foreground arm verbatim (rendered through `renderResult`, carrying `[exit code: N]` / `[timed out after Nms]` / `[sandbox: file access denied under <mode> mode]` markers as today); a pre-execute denial of one element renders into that element's frame without failing the outer call; the next element still runs. An outer abort follows a per-run AbortController as in PTC: remaining elements are recorded `not-run` with reason `call aborted` and the outer settles `TOOL_ABORTED`, mirroring the dispatch queue's abandon-queued-calls settlement. A `run_in_background` element dispatches the singular face's own background path — one `ctx.jobs` task each (kind `bash`/`pwsh`, label = element command, owner = the calling agent) through the same `processOutcome` adaptation — producing a `job` frame.

Model-facing rendering of the frames arm is one labeled section per element, reusing the existing markers verbatim:

```text
[1/3] $ pnpm test -t user-api
...element stdout/stderr, its markers...
[2/3] $ grep -rn "route" packages/api/src
...
[3/3] $ git status
...
```

Because each foreground element's text is exactly `renderResult(element)`, the `parseExitStatus` marker contract holds at element granularity for any future per-frame consumer, and the singular arm's trailing-marker contract (which the terminal result card's exit pill anchors on) is unchanged.

### Rendering and presentation parity

Both tools consume the same frame renderer and the same inner-element renderer family (`renderResult`, sandbox markers, escalation hints), so the mirrored-surface contract the parity note owns extends to the frames arm: consumers of one tool's output must accept the other's. The frame renderer therefore lives where the already-shared half lives — `@deepseek-ai/dsh-shell` exports `parseExitStatus` to `dsh-tool-pwsh` today for exactly this reason — as a new `renderFrames(frames, escalationModes)` beside it; the two tool packages keep only their tool-name-specific registration and presentCall views.

Presentation: a frames call presents as a `generic` card with `kind: 'execute'`, title `N commands: <first command>`, one content line per element (`$ <command> — <description | elided>`), and `rawInput` the commands array JSON. The result presents as `generic` fenced console text carrying the sectioned rendering (the terminal card stays single-command: its exit pill cannot represent N exits). This follows the render-intent vocabulary ([tool render intent union](../../implemented/architecture/2026-07-02-tool-render-intent-union.md)); if later UI work wants per-element terminal sub-cards, that is a new view kind with its own note, not a frames rewrite.

The persistent variant (`tool-bash-persistent`) keeps its string-valued output by contract and gains `commands` by rendering the same sectioned text into that string inside the existing per-owner serialized queue; `run_in_background` elements in an array reuse the existing per-owner background-shell start from the workspace. It never overlaps elements (its value is shell-state continuity across calls), which stays true because it does not advertise `isConcurrencySafe` at all.

### Execution and concurrency classification

V1 ordering is serial, in submission order, exactly like the PTC dispatch queue's serialized placeholder. Serial order alone deletes the round trips, which is the entire cost lever; v1 ships no new classifier.

The frames face declares no `isConcurrencySafe` in v1: an outer frames call classifies exclusive exactly like a singular bash/pwsh call today, so the native rolling pool's across-call behavior of the shell family is byte-stable, and serial-in-submission order within the call is the round-trip lever — overlap is not. Because elements dispatch the singular face, the deferred read-only classifier lands with a single declaration on the singular face: both directly emitted singular calls and array elements inherit overlap through the same pool, capped like the PTC dispatch pool, while escalation-bearing or background-bearing invocations still classify exclusive as an invocation-level rule of the frames loop.

Each element's request is built by the existing per-call resolution (workdir fallback chain, `dshEnv`, standing sandbox policy), element overrides applied last. The sandbox policy resolves once per invocation from the standing policy, never per element; an escalation denied by `approveEscalation` fails the whole invocation before any element starts, matching singular semantics.

### PTC projection

`renderToolsSdk`'s bash example (`packages/core/tools/src/ts-types.ts`, `renderBashExample`) is updated to recognize the `commands` array: when advertised, the emitted example shows one `tools.bash({ commands: [{ command: 'pwd' }, { command: 'ls' }] })` call, and the program instructions gain one line — inside a program, prefer one awaited `bash` call with a `commands` array over `Promise.all` of singular `bash` calls, since ordering and labeling are free. The codegen already renders arrays of objects through `jsonSchemaToTs`, so no generator change is required; only the example-eligibility predicate widens (it currently requires `required` ⊆ {command, description}).

### Prompt wording

Each tool's `tool:bash`/`tool:pwsh` advice section gains the mid-execution batch example the guidance lacks — the rule text states batching at onboarding, but models generalize a rule to where its examples live: "Use `commands` for independent shell work arriving together — e.g. after a failing test, one call running the narrowed test, grepping the symbol, and listing the suspect directory. Elements run in written order and every element runs even if an earlier one fails; sequence dependent steps as separate calls that read the earlier result." The per-element `description` reuses the singular's active-voice guidance.

### Documentation and coordination

- Update [pwsh tool/bash parity](../../implemented/feature/2026-08-02-pwsh-tool-bash-parity.md) in the implementing PR: the mirrored surface grows by one parameter group; the jscpd-ignore symmetry markers move to the shared `dsh-shell` frames renderer, shrinking the duplicated region.
- Update each tool package README's Model Experience section (commands-array emission guidance, frames output) and the `dsh-shell` README's shared-rendering inventory.
- Snapshot fixtures pin: the frames arm schema text in native and `both` assemblies, the sectioned rendering, the generic cards, and the singular arm's byte-identical behavior; a real-composition test boots `cordis.yml` with a confining executor and asserts element-wise denial markers plus escalation-fails-whole-invocation through the executor, per the REAL-composition policy.

## Alternatives considered

**Teach models to emit parallel singular invokes.** That is the problem statement, not a solution: the rolling pool already executes whatever is emitted, and emission is the behavior prompt prose has failed to move.

**Route batching through PTC `run_code`.** Correct for in-process targets (lsp, subagent, ask-user) and complementary, but for shell-shaped discovery it wraps a shell one-liner in TypeScript ceremony and yields string stdout per binding instead of canonical frames; the PTC note itself defers mode guidance to post-ship measurement.

**Keep the single command, document `;`-chains.** Loses exactly the facts (per-command exit code, denial attribution, per-command spill) that make tool results trustworthy, and models already avoid `;`-chains for that reason.

**A separate `batch_shell` tool beside `bash`.** Doubles the surface the parity note must mirror, makes visibility scoping choose between two shell affordances, and splits model behavior across near-duplicate tools instead of upgrading the one tool every profile, hook, and snapshot already understands. The write tool precedent (an `edits[]` array on `write`) argues for face-extension.

**One command string plus a per-line exit-code protocol.** Would require a wrapper shell around each element (echoed sentinels between commands), which breaks on interactive stdout, complicates sandbox denial attribution through the wrapper layer, and reimplements per-element requests one shell layer above where `ctx.shell` already provides them.

### Why not ack result plus injected element context?

The injection reading of the wheel splits into the two injection planes the harness already ships, and neither is a saving for foreground work. Same-step injection is `deferContext` itself: deferred contexts are appended in the step that carries the outer result, so an acknowledgement result plus injected element output delivers the identical bytes in the identical cache-read turn as rendering the frames into the result — the choice collapses into which block carries the output, where the result wins its two anchors (the terminal result card reads durable `tool/result.content` at the call site, the same reason PTC renders `run_code` completions into its result instead of deferring them; and the `check the [exit code: N] marker on every bash result` guidance anchors to result position, not to parentless user-role blocks whose canonical cargo is short instructions). Cross-step injection is the jobs completion-notice plane, which by definition opens a new turn around the notice — the background contract — so a blocking discovery flow would end its turn without outputs and pay back the round trip the design removes; the genuinely asynchronous half is already the frames background face (`job` frames, `job_output`, notices). The frames design is the midpoint: same-step, one result block, with the async variant per element where latency tolerance is real.

### Synthetic pairs — rejected at the storage plane, deferred at the projection plane

Minting parented `tool/call` or `tool/result` *session events* for the elements is rejected. `tool/call` has exactly one producer semantics — the agent loop appends it when the model emitted a block (`agent-loop/tool-calls.ts`) — so an event minted for a call the model never emitted either rewrites that tag's semantics (a SESSION_FORMAT_VERSION bump, a third migration package, the runtime alias the [PTC mode note](../../implemented/feature/2026-06-15-ptc.md) refuses) or lies to every consumer of the loop-branch today. Query-side uniformity instead stays a derived view: consumers union the root `tool/call` stream with `tool/ptc-dispatch` settlements (parent call id, deterministic element ids, normalized arguments), per the packages/AGENTS.md idiom.

The *model-visible* half of the same idea is the deferred v2 of this design, and is a feature rather than a deception: a model is stateless over its request — it infers what it did from the transcript, and a transcript that shows its own fan-out as an assistant turn of batched `bash` `tool_use` blocks with their per-element results is precisely the batched-emission demonstration that v1 prompt prose cannot supply. Its shape, keeping every stored contract byte-stable:

- Storage appends nothing new: the root `tool/call`/`tool/result` pair for the frames invocation plus the elements' existing log-only `tool/ptc-dispatch-start`/`tool/ptc-dispatch` pairs are the complete fact set.
- The outer execution defers one fanned-out context block after its root result — the sole model-visible carrier, appended after the outer `tool/result` exactly as `deferContext` commits — carrying the rendered batch turn. A deferred block may in practice exceed nested `additionalContexts`, and the frames loop is its only minting producer; its honestness (only executed elements appear, abandon-on-abort completeness) is enforced because the loop builds it from the same dispatch settlements the log carries.
- The request projection renders that deferred block as an assistant message containing N `bash` `tool_use` blocks (grouped, ordinary cards — presentation derives from the raw dispatch events and `parentCallId` exactly as the Web client already does for Code dispatches) followed by the N matching user-side `tool_result`s. The model-visible ⟺ logged invariant holds because the block is a pure derivation of logged dispatch events, and reconstruction from the log reproduces the batch turn without extending `tool/call` semantics — the same mechanism memory already renders deferred context; `compositional compatibility` therefore touches the request-construction path, not the session format.
- The batches the model later emits ride the shipped native rolling pool, so this plane pays off only together with the deferred read-only classifier ([alternatives](#alternatives-considered)) and with measured evidence that reading its own batched turns shifts emission — the v1 frame plane ships first and supplies that evidence through the dispatch telemetry.

V1 therefore keeps the frames value in the outer `tool/result.content` (§Frame model): same-step, single block, zero projection coupling; the fanned-out deferred block remains the v2 proposal.

**A read-only classifier enabling parallel element execution in v1.** The overlap win is wall-clock, not tokens, and trustworthy shell-read classification is a parsing swamp (`$(...)`, aliases, pipelines). Deferred behind telemetry; the frames surface plus `isConcurrencySafe` adds it later without schema churn.

## Acceptance criteria

- `bash` and `pwsh` accept singular and `commands` faces; singular args produce byte-identical canonical values, renderings, and cards against the existing snapshot fixtures.
- A frames invocation runs every element in order; a failing, timing-out, or sandbox-denied element appears in its own frame with the existing markers and does not suppress later elements; abort records the remainder as `not-run`; element dispatches pass `tools/pre-execute`/guards as separate pipeline executions and log `tool/ptc-dispatch` pairs with the existing id scheme.
- Background elements register independent `ctx.jobs` tasks readable by `job_output` and killable by `job_kill`; a frames call classifies exclusive in `executionMode` in v1 exactly like a singular call, so across-call scheduling is byte-stable.
- The frames wall runs through the unmodified pipeline: a `tools/pre-execute` listener runs per element and may deny one element without failing the call, and a confining executor's denial surfaces per element through the shared `dsh-shell` renderer into that element's frame.
- PTC assemblies render the `commands` example and instruction line; native assemblies' tool list changes only in the two tools' parameter schemas.
- Per policy, REAL-composition tests assert denial and escalation through a booted confining executor, and the parity note plus both package READMEs ship updated in the same PR.

## Risks

**Chains smuggled as batches.** Models may put dependent steps in one `commands` array; the mitigation is the element-wise failure markers plus the explicit ordering sentence in the guidance — the model sees `[exit code: N]` for the broken link and every later frame, exactly the facts a `;`-chain would have hidden. Telemetry on consecutive-element exit-code correlation can detect systematic misuse later.

**Approval plane.** Element dispatches are real pipeline executions, so a per-element `tools/pre-execute` approval plugin could in principle prompt per element; v1 keeps the approval plane at the outer gate — one all-or-nothing prompt listing every element command — with per-element denials surfacing as frame markers, and silent-denial automation compositions stay silent per element exactly as today. Escalation stays singular-only in v1 so widened authority never rides an array; a nested-dispatch approval UX defers with the classifier v2.

**Context-heavy frames.** Per-element truncation/spill caps already bound each stream at the executor; a summed per-invocation output budget is deliberately deferred until telemetry shows whether eight tail-truncated frames ever exceed what eight singular calls would have cost.

**Parity drift.** Two tools growing one face risks divergence; the shared `dsh-shell` frames renderer (the same mechanism that already shares `parseExitStatus`) is the enforcement, plus the parity note's mirror requirement.
