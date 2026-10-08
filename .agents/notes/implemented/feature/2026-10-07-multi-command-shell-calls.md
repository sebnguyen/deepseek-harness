# Agent Note: Multi-command shell invocations — one bash call that fans out

Status: implemented

## Problem

The dominant cost of shell-driven exploration is agent turns, not commands. A discovery step ("what fails, where, and what does the tree look like") is three to five one-line shell invocations, and models overwhelmingly emit them one per step — the same 1-thought-1-call degeneration observed across harnesses — so each cheap command pays for a full cached-context model round trip. The loop already executes multiple emitted calls in a bounded rolling pool ([parallel tool-call execution](2026-07-10-parallel-tool-call-execution.md)), but that only parallelizes calls the model decided to emit together, and mid-task models do not emit batches: independence has to be *asserted* at emission, which is exactly the analysis the model distrusts once results start mattering. Prompt prose ("batch independent calls") is empirically insufficient because it fights that emission-time uncertainty.

The harness's other tools already solved this by putting the loop inside one invocation: `write` takes an `edits[]` array, delegation tools take `tasks[]`. A single array parameter reads to the model as one atomic, recoverable action, so it is emitted where five parallel invokes are not. The shell tool offered no such surface: `bash` accepts exactly one opaque `command` string, and the recovery path models fall back to — `;`/`&&`-chaining in one string — destroys the facts a model needs to reason safely: per-command exit codes collapse into the last one, per-command output becomes undecodable interleaved text, and a timeout or sandbox denial kills or obscures the whole chain. There was therefore no low-risk encoding for "run these N independent shell jobs": one invoke per job (turn-heavy) or one unstructured string (fact-lossy).

## Decision

Shipped as a mountable successor provider, `@deepseek-ai/dsh-tool-bash-frames`, which registers the same model tool name `bash` under the same plugin id (`tool-bash`) with the v1 singular face byte-identical plus the batch face. The shipped compositions — `dsh-base`'s cordis patch and all five shipped agent presets — mount the provider by package name while keeping the id, so id-only disables and id-keyed tool hiding keep working, and the singular `dsh-tool-bash` stays published and untouched for profiles that name it directly. The persistent stack stays published for the one composition that still mounts it, the standalone `sdk-minimal` bundle, and for the Web snapshot fixtures that replay through it. Both providers consume the same `ctx.shell` seam; mounting both would duplicate the tool name, which their READMEs state.

The `commands` face carries 1..`maxCommandsPerCall` elements (validated `Config`, default 8), each with required `command` plus optional `description` (UI label defaulting to the command), `workdir`, `timeoutMs`, and `run_in_background` (advertised iff `enableRunInBackground`). At launch `command` and `commands` were mutually exclusive and `sandbox_permissions`/`justification` were singular-only; the [commands-only bash surface](2026-10-07-commands-only-bash-surface.md) made the batch face the tool's only call shape and moved backgrounding and escalation onto elements. Element item schemas are permissive (`additionalProperties: true`) exactly like the singular root schema: an undeclared element key reaches execute, where the per-call opt-out (`enableRunInBackground: false`) is enforced at dispatch time.

The frames loop dispatches each element serially, in submission order, through the same explicit `resolve(request): Spec` + `ctx.shell.run` path the singular face uses, so every element inherits workdir defaulting, the managed `dshEnv`, and the standing per-call sandbox policy (including a pre-dispatch escalation, which fails the whole invocation before any element starts, matching singular semantics). Each element settles independently into its own frame: a foreground element embeds the singular canonical result verbatim, a background element registers a `ctx.jobs` task (kind `bash`, label = element command, owner = calling agent) and yields a `job` frame with the registry id, and an element skipped after a call-signal abort yields `not-run` with reason `call aborted`. A non-zero exit or sandbox denial on one element is reported in its own frame and never suppresses later elements; a mid-loop abort settles the remainder as `not-run` frames inside the frames value, while the tool scheduler's caller-cancellation contract overlays the bare abort error on the model-visible result.

Model-facing rendering is one labeled section per element under `[i/N] $ <command>`, each section rendering through the singular marker grammar. The shared renderers (`renderResult`, `renderProcessRead`, `parseExitStatus`) moved from `dsh-tool-bash` into `dsh-shell` beside `parseExitStatus`'s existing home there, and the new `renderFrames(frames, escalationModes)` lives with them; both tool packages import them from `dsh-shell`, deleting their private render twins and shrinking the parity-mirrored region. Presentation: a pending frames call is a `generic` card with `kind: 'execute'`, title `N commands: <first command>`, and one `$ <command>` content line per element; a settled frames result renders as generic fenced console text because one terminal exit pill cannot represent several elements.

Each tool's `tool:bash` prompt section adapts the batch habit with a mid-execution example (one call for the narrowed test, the symbol grep, and the directory listing) and the ordering fact (elements run in written order; every element runs even if an earlier one fails). `renderToolsSdk`'s bash example predicate already accepts the frames schema unchanged, since `required` remains within `{command, description}` and the example literals still satisfy the singular strings.

V1 keeps the frames value in the outer `tool/result.content` and declares no `isConcurrencySafe`, so a frames call classifies exclusive exactly like a singular bash call and across-call scheduling is byte-stable. The loop keeps approval at the outer gate: composition guard plus shared fail-closed sequence live in the exported `requestBashEscalation` (rejects `sandbox_permissions` without a sandboxing executor, then delegates to `approveEscalation`), testable without a schema-gated boot.

## Alternatives considered

**Teach models to emit parallel singular invokes.** That is the problem statement, not a solution: the rolling pool already executes whatever is emitted, and emission is the behavior prompt prose has failed to move.

**Route batching through PTC `run_code`.** Correct for in-process targets (lsp, subagent, ask-user) and complementary, but for shell-shaped discovery it wraps a shell one-liner in TypeScript ceremony and yields string stdout per binding instead of canonical frames; the PTC note itself defers mode guidance to post-ship measurement.

**Keep the single command, document `;`-chains.** Loses exactly the facts (per-command exit code, denial attribution, per-command spill) that make tool results trustworthy, and models already avoid `;`-chains for that reason.

**A separate `batch_shell` tool beside `bash`.** Doubles the surface, makes visibility scoping choose between two shell affordances, and splits model behavior across near-duplicate tools instead of upgrading the one tool every profile, hook, and snapshot already understands. The write tool precedent (an `edits[]` array on `write`) argues for face-extension on the named tool; the successor-provider topology keeps that face on the `bash` name without editing the shipped singular package.

**One command string plus a per-line exit-code protocol.** Would require a wrapper shell around each element (echoed sentinels between commands), which breaks on interactive stdout, complicates sandbox denial attribution through the wrapper layer, and reimplements per-element requests one shell layer above where `ctx.shell` already provides them.

**Edit `dsh-tool-bash` in place.** Spreading the face across both shipped tools plus their pwsh and persistent twins meant four packages changing together under the parity contract; the mountable-successor topology ships the face where the shipped presets point, leaves proven singular behavior byte-stable, and lets the remaining twins adopt the shared `dsh-shell` frames renderer one at a time.

### Why not ack result plus injected element context?

Same-step injection is `deferContext` itself: deferred contexts are appended in the step that carries the outer result, so an acknowledgement result plus injected element output delivers the identical bytes in the identical cache-read turn as rendering the frames into the result — the choice collapses into which block carries the output, where the result wins its two anchors (the terminal result card reads durable `tool/result.content` at the call site; the `check the [exit code: N] marker on every bash result` guidance anchors to result position). Cross-step injection is the jobs completion-notice plane, which by definition opens a new turn around the notice — the background contract — so a blocking discovery flow would end its turn without outputs and pay back the round trip the design removes; the genuinely asynchronous half is already the frames background face. The frames design is the midpoint: same-step, one result block, with the async variant per element where latency tolerance is real.

### Synthetic pairs — rejected at the storage plane, deferred at the projection plane

Minting parented `tool/call` or `tool/result` *session events* for the elements stays rejected: `tool/call` has exactly one producer semantics — the agent loop appends it when the model emitted a block — so an event minted for a call the model never emitted either rewrites that tag's semantics or lies to consumers.

The *model-visible* half remains the deferred follow-up and is a feature rather than a deception: a transcript that shows the agent's own fan-out as an assistant turn of batched `bash` blocks with per-element results is the batched-emission demonstration that prompt prose cannot supply, projected at request construction from a deferred fanned-out context block derived from the logged element settlements, keeping every stored contract byte-stable.

**A read-only classifier enabling parallel element execution.** The overlap win is wall-clock, not tokens, and trustworthy shell-read classification is a parsing swamp (`$(...)`, aliases, pipelines). Deferred until telemetry; the frames surface plus a later `isConcurrencySafe` declaration adds it without schema churn.

## Consequences

- Shipped profiles now mount the frames provider; recorded sessions from either provider replay through the same singular schema, and the frames arm correlates by call id — no session-format bump, no migration package.
- The renderers are now one `dsh-shell` home consumed by both bash tool packages; the pwsh and persistent twins retain their own render twins and may adopt `renderFrames` later without schema churn.
- Elements dispatch the executor seam directly rather than nested registry executions: per-element `tools/pre-execute` hooks and per-element log-only dispatch events are not part of v1, and sandbox denials surface through the executor's per-run facts rather than through pre-execute denial. Recorded denial markers, spill paths, and job vocabulary are identical either way; the nested-dispatch shape (per-element pipeline executions, `<outer>:ptc:<n>` id pairs, `deferContext` ferry) remains the deferred mechanism for the projection-plane follow-up.
- Escalation shipped singular-only and later became an element-scoped wrapper of the same approval sequence when the batch face became the tool's only call shape ([commands-only bash surface](2026-10-07-commands-only-bash-surface.md)); the same-turn escalation habit from the sandbox note survives unchanged.
- `maxCommandsPerCall` and `enableRunInBackground` are validated `Config` fields on the frames plugin per the no-hardcoded-tunables convention; the generated config and tool catalogs enumerate the package like every shipped tool package.
- One exit pill cannot render N exits: frames results stay generic cards, and both presenters degrade to raw output for scheduler-level aborts and non-object args.

## Testing

Per-file 100% statements/lines (branch floor 60%) over `tool-bash-frames`, `tool-bash`, and `shell` sources; REAL-composition suites boot the Loader-shaped plugin chain (system prompt, tools registry, agent registry, subprocess runtime, shell env, executor) plus the generic job runtime for background frames, and assert: ordered per-element frames including a failing element, mid-loop abort settling the remainder as `not-run`, executor-confined denials confined to the denied element's frame, background elements readable through the real `job_output` tool, the singular-only escalation guard, and the pending/settled card shapes. Sectioned rendering and the shared renderers are pinned in `dsh-shell`'s own suite. Snapshot assemblies whose tool catalog or prompt embeds the bash schema are refreshed in the same change.

## Risks

**Chains smuggled as batches.** Models may put dependent steps in one `commands` array; the mitigation is the element-wise failure markers plus the explicit ordering sentence in the guidance — the model sees `[exit code: N]` for the broken link and every later frame, exactly the facts a `;`-chain would have hidden. Telemetry on consecutive-element exit-code correlation can detect systematic misuse later.

**Approval plane.** v1 keeps the approval plane at the outer gate — one all-or-nothing decision scoped to the call — with per-element denials surfacing as frame markers, and silent-denial automation compositions stay silent per element exactly as today. Escalation stays singular-only so widened authority never rides an array.

**Context-heavy frames.** Per-element truncation/spill caps already bound each stream at the executor; a summed per-invocation output budget is deliberately deferred until telemetry shows whether eight tail-truncated frames ever exceed what eight singular calls would have cost.

**Parity drift.** The pwsh and persistent twins do not advertise `commands` yet; the shared `dsh-shell` frames renderer (the same mechanism that already shares `parseExitStatus`) is the enforcement when they adopt the face, and their READMEs say so under Known Limitations.

## Deferred work

- `commands` face on `dsh-tool-pwsh` and the persistent twins, through the shared `renderFrames`.
- Nested-dispatch element execution with per-element `tools/pre-execute` hooks, log-only dispatch pairs, and `deferContext` ferrying; the request-projection batched-turn follow-up.
- A read-only concurrency classifier and per-invocation output budget, telemetry-gated.
