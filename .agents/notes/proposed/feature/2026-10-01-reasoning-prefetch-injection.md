# Agent Note: Reasoning-driven read prefetch with next-step injection

Status: proposed

## Problem

Agentic session latency is dominated by model round trips; local file I/O is milliseconds by comparison. A typical orientation step spends an entire request cycle on `read`/`grep`/`glob` calls whose targets the model already settled while thinking.

On the wire standards this harness serves, reasoning precedes visible output and tool calls **within one completion**. DeepSeek's OpenAI-compatible surface streams `reasoning_content` deltas before `tool_calls` deltas in the same assistant message (`packages/llm/llm-deepseek/src/translate.ts`), and OpenAI's reasoning models place reasoning items before the message/function_call items of the same response under one shared output-token budget — exhausting it mid-reasoning yields an incomplete response with no visible output (OpenAI, *Reasoning models* guide). The completed reasoning text routinely names files the model is about to inspect, in this step or a later one. Both LLM adapters normalize that stream into the same `reasoning-delta` chunk vocabulary (`packages/llm/llm-pi-ai/src/stream.ts`), and the agent loop already publishes every live chunk as `agent/assistant-stream` frames (`packages/core/agent-loop/src/agent.ts`).

Nothing consumes that signal today. Every orientation target the reasoning already decided costs a full round trip at a later step. The seams this proposal consumes are owned by the [interception extension-points Agent Note](../../implemented/feature/2026-06-30-interception-extension-points.md): `agent/pre-step` admits listener-contributed messages into the request batch, `agent.inject()` queues sourced context for the nearest step boundary, and injections enter the active-batch FIFO. This note proposes a producer on that surface; it supersedes nothing in it.

## Proposal

One opt-in experimental plugin over three existing seams — `agent/assistant-stream` for observation, the fs tool gate for a policy-routed preread, and the pre-step waterfall for durable next-step injection. Zero agent-loop changes. A private prototype ships as `@deepseek-ai/dsh-experimental-reasoning-prefetch` (`packages/experimental/reasoning-prefetch`); where this proposal and the prototype diverge, the prototype's shipped behavior is the literal fact (its README records the deferred pieces), and the proposal keeps the fuller target design.

### Observation: whole-reasoning parse at a chosen point

Accumulate `reasoning-delta` frames per attempt into an assembler; deltas append only and are never parsed — the parse runs exactly once over the attempt's assembled reasoning blocks. Under interleaved thinking an attempt closes several reasoning blocks, one before each tool-call run; every block is parsed, each predicting the reads that follow it, at a deploy-chosen moment: `parsePoint: 'attempt-end'` (default) parses at the attempt's terminal frame, while `pre-step` defers the parse to the next pre-step, composing the injection inside the same waterfall that admits it. Both points parse the same material — the entire message the model just sent: the terminal frame's assembler and the pre-step's stashed copy hold identical text.

The chunk vocabulary is provider-neutral, so the portability gate is runtime, not config: on surfaces where no readable reasoning streams (OpenAI Responses raw reasoning is opaque — summaries at best), the attempt yields no reasoning blocks and the plugin no-ops.

### Why two parse points

`attempt-end` preserves the overlap that makes the round trip worth eliminating: parsing at the terminal frame starts every preread while the attempt's tool calls still execute, and nothing enters the next request's critical path — the next pre-step only stages already-running or settled prefetches. `pre-step` is the simpler composition you described — one listener views the last assistant attempt, parses it, runs the prereads bounded by `prefetchWaitMs`, and returns them in its own `PreStepDecision.enter` batch per the interception note — at the price of placing the preread on the request path and dropping prefetches that cannot settle inside the bound (typically ignorable for fast local providers, material for sandbox fs). A pre-step parse cannot use `inject()` for its own step: an injection issued inside step N+1's pre-step misses the batch N+1 already claimed and would land one step late, so the injection must ride the decision's messages. Neither point parses fragments; the knob trades where the I/O sits against code shape.

### Detection: intents, candidates, grounding

Detection is three layers — spans, intent, grounding — all regex and stat, no second model call, and every candidate must name a real path before it can cost anything. The parse walks the attempt's assembled reasoning blocks once, at the parse point; nothing incremental. A fragment is by construction a prefix of something — a mid-token `tool` prefix-matches `tools/`, `tool-calls.ts`, anything — so deltas never enter the detection layers. Span and intent evidence is therefore whole per block, and same-attempt dedup is a plain set difference over that attempt's tool-call blocks, which the assembler holds beside the reasoning.

**Spans.** Per assembled reasoning block: backticked spans (the highest-precision carrier of paths and identifiers); `@path` / `@"path"` spans — the `@`-mention grammar the model itself is prompted with (`dsh-file-reference`); bare path-like tokens — `(?:[\w@.-]+/)+[\w.-]+\.(ts|md|mdx|json|ya?ml|py|go|rs|sh|txt)` with an optional `:line` suffix, plus absolute and `~` paths; trailing-slash directory spans; and quoted strings, which are search-term candidates only, never reads. Clean spans carry their path in the span itself and need no matching; only quoted terms and bare identifiers ever reach the fuzzy layer.

**Intent.** A span is inert until its sentence, or the one before it, carries its verb class: read verbs (*read, open, check, look at, inspect*) → read; search verbs (*grep, search for, find usages/callers/references of*) → grep; listing verbs (*list, ls, explore, layout, structure*) → glob. One deliberate asymmetry: a bare path span implies read without a verb, but a quoted term implies grep only beside a search verb and a directory span implies a capped listing only beside a listing verb — the shapes that stop arbitrary quoted prose from becoming repo searches.

**Grounding.** Each read/glob candidate resolves against the session workspace stored in the header — `exec.agent.session.header.cwd`, exactly the root `sessionCwd()` (`packages/fs/tool-fs/src/session-cwd.ts`) resolves the read/write/edit tools against. Clean spans resolve directly against that root through the fs gate: one provider stat — file → bounded read, directory → bounded listing, absent → dropped. Never fuzzy; never through the index.

Fuzzy mentions (a quoted term, or a bare identifier with no path shape) resolve through the existing `WorkspaceFileSearch` index from `@deepseek-ai/dsh-file-reference-local` (`packages/context/file-reference-local/src/search.ts`) — and only when the `fuzzyTerms` config option is enabled, default off. With recall-biased staging, a fuzzy term no longer fails closed (ambiguity → nothing): it fails *open* — a hallucinating segment’s loose terms would each stage up to twenty subsequence-ranked capped reads — so the cautious posture is off. The trade accepted: fuzzy expressions become undetected misses that degrade to the ordinary tool call, while verb-gated quoted grep terms and every clean span stay on. When a deployment does enable it, the plugin queries the same per-agent instance `LocalFileReferenceService` already mounts (`packages/context/file-reference-local/src/index.ts`): root `agent.session.header.cwd`, invalidated on every `tool/result`, disposed with the agent — the identical tree the completion offers, at no second traversal. Grep candidates keep their quoted term, scoped to a co-mentioned path span when one exists; the injected material is capped result lines with provenance, not raw file content.

### Calling the seam

The plugin is a function plugin (`name` / `inject` / `Config` / `apply`) with `inject = ['agents']` only; the discovery seam stays optional and is read live at the parse point per the optional-service rule: `const fileReferences = ctx.get('fileReferences')`, undefined when no provider is mounted, which is the providerless no-op. One listener consumes the scoped stream event whose payload already carries the target: `ctx.on('agent/assistant-stream', ({ agent, frame }) => …)`, accumulating `reasoning-delta` text per `frame.attemptId`; the terminal frame seals the attempt so `attempt-end` can parse its reasoning blocks, while `pre-step` holds the sealed copy for its pre-step listener.

Clean-candidate staging never touches the service: path-shaped spans stat and read or list directly through the fs gate per the paragraph above. The seam's `list()` serves only fuzzy terms, and only with `fuzzyTerms` enabled — one cancellable call per mention batch:

```ts ignore-check
if (!config.fuzzyTerms) return // loose terms unstageable by default
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(new Error('prefetch window elapsed')), config.prefetchWaitMs)
let candidates: FileReferenceCandidate[] = []
try {
  candidates = await fileReferences?.list(agent, term, controller.signal) ?? []
} catch { candidates = [] } finally { clearTimeout(timer) }

for (const candidate of candidates) stage(candidate) // caps inside stage() refuse overruns
```

Inside that conditional the returned array is consumed as-is — the service's ranking is the order, `stage()` walks it until the caps refuse (`maxFiles` counts content reads only, directory listings and grep lines draw on `maxTotalBytes` alone, `maxFileBytes` clamps each read), and no score is ever recomputed: the tiers stay `search.ts` trivia, not an injection invariant, so no later edit to that file silently changes what gets injected. The one blind spot of order is accepted on purpose for a term the operator explicitly enabled: a lone subsequence hit at rank one stages as a capped miss, because the provenance header plus the re-read contract make over-injection cost tokens while under-injection costs a whole round trip. A slash-shaped span rides the same method — a query like `packages/fs/tool-fs/src/` enters the live `listDirectory` arm, so directory-intent mentions and glob intents cost one bounded ranked listing.

Per-block parse quality is a ladder, best to worst: backtick, bare-path, and `@` spans; verb-classified quoted terms; and, only when `fuzzyTerms` is on, ranked index matches under the caps — a fuzzy term's noise costs budget, not a gate or a discard, when disabled it is simply absent. A paraphrase with no discriminative token is undetected, which degrades to the ordinary tool call. Budgets cap the aggregate per attempt, so one verbose block cannot overrun them.

### Prefetch execution: policy-routed, bounded, silent

Each survivor goes through the same gate the `read` tool runs (`packages/fs/tool-fs` gate over session policy), branching on `kind`: files are read with content plus the observed version the read path already stats for (`packages/fs/tool-fs/src/read.ts`); directories produce only their ranked path-only listing lines; grep prospects produce capped result lines under their scope. Bounds: `maxFiles`, `maxFileBytes`, `maxTotalBytes`. A policy denial, absence, or I/O failure drops the candidate silently — speculation never surfaces an error to the model or the user, and never bypasses policy.

### Dedup against the same attempt's calls

The same attempt's tool-call deltas name the files the in-flight step actually reads; those results arrive as ordinary tool results and are excluded from injection. Survivors — predicted-but-not-called — are the injection set.

### Injection at the next pre-step

With `parsePoint: 'attempt-end'` the plugin stages one user-role message through `agents.inject()` (`packages/core/agent/src/runtime-types.ts`), which the next pre-step admits via `PreStepDecision.enter.messages` and commits to session history — model-visible ⟺ logged holds by construction. The interception note's active-batch FIFO rule means an injection racing an in-flight step lands in that step's batch; `prefetchWaitMs` bounds only the plugin's own preread wait, never the FIFO. With `parsePoint: 'pre-step'` the same message instead rides the pre-step listener's own `PreStepDecision.enter` batch — the interception note's listener-contributed context — because an `inject()` issued inside a pre-step misses that step's already-claimed batch by one. The message carries:

- a header naming its source: "Harness detected these potential reads in your reasoning stream; staged just now:"
- per file: path, observed version/mtime, byte count, then content
- per directory: path, then its ranked path-only listing lines
- one contract sentence: "Content is fresh as of the observed time. Use it directly; call read only if something later must be newer."

If the preread is still in flight when the target step's pre-step runs, the plugin's `agent/pre-step` listener awaits it bounded by `prefetchWaitMs` and skips past that bound; injection never delays a request unboundedly. The shipped v1 prototype rides the pre-step decision under both `parsePoint` values — staging still starts at attempt end, but only the injection waits at the step — which keeps arrival deterministic; the `inject()` FIFO composition above remains the design for letting staging settle past the step boundary.

### Config

`maxFiles`, `maxFileBytes`, `maxTotalBytes`, `prefetchWaitMs`, `fuzzyTerms` (off is the cautious posture against loose-term noise), and `parsePoint` (`'attempt-end'` default: prereads overlap tool execution, off the request path; `'pre-step'`: single-listener composition, preread inside the request bounded by `prefetchWaitMs`) are validated `Config` fields settable from cordis.yml. The plugin mounts only where a profile opts in; shipped defaults are unchanged.

### Telemetry

Session events per attempt record candidates predicted, files injected, and — at the following step boundary — injected∩read. The per-provider hit rate is the graduate-or-drop signal.

## Alternatives considered

### Why not scan partial deltas mid-stream for the current step?

Partial-text extraction is lower-precision, and the current step's calls are decided by the time reasoning completes — predicting them saves local I/O milliseconds, not a round trip. Segment completion is the first point where full evidence and a still-open request (the next step's) coincide.

### Why not a warm cache behind read instead of injection?

Serving a speculative read from a warm buffer saves only I/O latency on fast providers and pays solely for slow ones (E2B sandbox fs, web fetch, LSP cold start). That is a complementary optimization, not the round-trip eliminator; it deserves its own proposal if slow-provider telemetry ever justifies it.

### Why not change the agent loop?

The plugin rule: every seam above already exists (`agent/assistant-stream`, `agent/pre-step`, `agents.inject()`), so the behavior lands as a plugin, not a loop edit.

### Why not a third-party mention scanner?

The dependency-over-hand-rolling policy forces the question. The ecosystem offers path parsers (`parse-path`), file-content extractors (`textract`), and URL linkifiers, but no maintained JS library scans arbitrary prose for workspace-relative file/folder mentions; the products that do (VS Code's terminal link detector) use regexes. The span layer is therefore two regexes — importing a library would import the same regexes — while the resolver half that could delete owned code is already in-house: `WorkspaceFileSearch` plus the fs tooling's session-cwd resolution.

### Why not provider-native reasoning carry-over (`reasoning.context`, `previous_response_id`)?

Orthogonal. Those replay opaque reasoning state for continuity; they expose no text to extract and eliminate no read.

## Acceptance criteria

- Opt-in profile on a DeepSeek thinking-mode session: a completed reasoning segment naming existing files produces one durable injected user message in the next step, admitted through the pre-step and visible in the session log.
- Files the reasoning-naming step actually called are never injected; files modified between preread and injection are dropped.
- A path-shaped span with no disk hit produces no injection; a fuzzy term produces nothing under the shipped `fuzzyTerms` default, and under an enabled deployment only what `list()` ranks, truncated by `maxFiles` / `maxFileBytes` / `maxTotalBytes`; quoted terms produce grep injection only beside a search verb; no parse ever runs on an incomplete delta fragment — the layers see only sealed reasoning blocks.
- Injected bytes respect the configured caps against oversized reasoning text, including capped grep result lines and directory listings.
- A preread of a policy-denied path produces no model-visible content and no logged error.
- A provider that streams no readable reasoning yields a clean no-op.
- Hit-rate telemetry events exist for every attempt that injected.
- The package ships a REAL-composition test, keyless recorded-session snapshot coverage, a README Model Experience section, and passes `verify-agent-note-format`, coverage, and hygiene gates.

## Risks

- Recall-bias trades precision for round trips; with `fuzzyTerms` off by default the standing fan-in is clean spans plus verb-gated terms, and enabling fuzzy accepts that a hallucinating segment can stage a capped budget of subsequence misses. Misses are bounded and visible in hit-rate telemetry, but an injected line persists in history as ignorable context until compaction, so its cost is persistent — budgets stay small and telemetry decides graduation.
- Model over-trust of injected content. Mitigated by the provenance header and the re-read contract sentence; still a behavior dependency to pin with snapshots.
- Speculative I/O on the host, bounded by the caps.
- Extraction may misparse prose as paths, quoted prose as search terms, or recap mentions of already-seen files as fresh intent; the verb+span shapes, the existence/type stat, the byte and item caps, and session-history dedup each bound one of these, and every miss degrades to the ordinary tool call.
