# Agent Note: Cross-harness benchmarking experiment — design, test set, and data-collection contract

Status: proposed

## Problem

We want to compare agent *harnesses* — dsh among them — holding the model
constant, over a shared problem set. The comparison is only worth running if
the numbers survive scrutiny: the same model, provider endpoint, sampling
parameters, problem set, and grader for every arm, with enough recorded
evidence that any later audit can reconstruct exactly what ran and why a
number came out the way it did. The field's own lesson motivates this: on
SWE-bench the scaffolding supplies most of the variance (a bare model scores
far below the same model under a good agent framework), so "which harness"
is the actual open question — and it is exactly the question benchmark
scores normally confound by changing many things at once.

Today we have no plan, no frozen problem set, no runner, and no data
contract. This note fixes all four before any data exists, so the rules
cannot be retrofitted to the results.

## Proposal

### The single-pin rule

One factor varies — the harness (system prompt + tools + context management
+ plumbing, treated as one indivisible treatment). Everything else is pinned
and recorded: model weights/version string, provider endpoint, sampling
parameters, problem set, time policy, grader, and grader version. Where two
harnesses genuinely differ on tool surface (e.g. one grants web access), the
difference is documented *as part of the treatment*, never silently
normalized.

### Budget policy

Primary lens is **harness-natural**: each arm runs the way it is designed
to run, and tokens/cost/turns/wall-time are reported as *outcomes*, separate
metrics alongside pass rate. A normalized fixed-budget lens may be computed
as a secondary view from the recorded data, but no attempt is ever cut off
by the comparator to make arms look comparable.

### Test set — Terminal-Bench 4.0.0 primary, SWE-bench Pro secondary, Commit0 capstone

The difficulty spectrum we need is *programming complexity through design
complexity*, and one suite does not cover it:

1. **Terminal-Bench 4.0.0 (primary — fetched, pinned, local).** The latest
   public version: 66 calibrated tasks, each a Dockerized environment with
   `instruction.md` + `task.toml` + `environment/` + `tests/` oracle.
   Version 4.0 recalibrated task resources (flat 8h agent timeout), fixed
   19 flaky/misspecified tasks, and removed 8 saturated or compromised
   ones; the benchmark is now continuously semantically versioned
   (Harbor Hub ref `terminal-bench/terminal-bench@4.0.0`). Built explicitly
   for agent comparison: the harness works inside a container with its
   natural tools rather than producing a git diff, which removes the
   patch-workflow assumption that biases SWE-bench-style setups.
   Fetched at tag `v4.0.0` (commit `452bf305`) into
   `idk/benchmarking/datasets/terminal-bench-4.0.0/` with the pin manifest
   `terminal-bench-4.0.0.pin.json` beside it (tarball SHA-256 recorded there).
2. **SWE-bench Pro public split (secondary, scale anchor).** ~730-instance
   public split of Scale AI's 1,865-task hard benchmark (multi-language:
   Python, JS/TS, Java, Go), created to dodge the contamination confirmed
   in SWE-bench Verified — where top models sit at ~80% and recall gold
   patches verbatim. Pro tops out near ~57% on the leaderboard, so there is
   real headroom and real discrimination. Fetch: Hugging Face
   `ScaleAI/SWE-bench_Pro`, pinned by dataset revision hash at fetch time.
3. **Commit0 slice (capstone, design complexity).** Build an entire Python
   library from scratch against a spec + hidden test suite — the one suite
   that exercises architecture/design rather than bug localization. Used
   as a small capstone slice, not a full run.
   Source: `github.com/commit-0/commit0`, pinned by commit SHA.

All three are containerized with executed (test-based) graders — no
LLM-judge anywhere in the primary pipeline.

### Grading design complexity — the three-layer stack

Correctness is executable; design is not — so design is never graded by a
single holistic score. We operationalize it into executable measurements
wherever possible and quarantine the remainder into an audited judgment
layer. Three layers, three authorities, reported in **separate columns
that are never blended**:

1. **Spec-delta protocol (primary design instrument, fully executed).**
   Design quality is the amortized cost of change, so grade the change:
   the agent first builds against spec v1, then a pre-planned spec delta
   (invert a requirement, add a capability) is applied and the hidden v2
   suite runs. Deterministic design penalty = lines touched vs. a
   reference minimal patch, blast radius (share of modules touched), and
   hidden v2 pass rate. Well-designed code localizes the delta; rigid
   code breaks broadly. This is the Commit0 capstone's real instrument
   (SWE-EVO does release-level evolution in the same spirit). Applies
   only to the design slice, so the doubled attempt cost stays bounded.
2. **Deterministic design proxies — LSP-driven (every attempt, cheap
   telemetry).** The deterministic design score comes from a **language
   server**, not text heuristics: LSP answers are a pure function of
   (source, pinned toolchain), so diagnostics, the symbol/reference
   graph, and call hierarchy are bit-reproducible once the server
   version is pinned in the run manifest. Metrics harvested per attempt:
   diagnostics by severity; unreferenced public symbols (dead/unused
   API-surface audit); reference-graph coupling — per-module fan-in/
   fan-out from *semantic* references, not import-string matching;
   call-hierarchy depth and cycles; public-API documentation coverage.
   Beside the LSP layer: executable architecture-constraint checks
   (must-not-import, cycle-freedom via import-linter/dependency-cruiser)
   written as part of each task's hidden spec, and the mutation score
   of the agent's own tests (mutant kill rate — executed, deterministic,
   measures whether its self-tests mean anything). All recorded as
   telemetry, none of it pass/fail on its own.
3. **Judgment layer — a strictly-prompted reviewer AI (subset only,
   quarantined, labeled, non-deterministic).** Where semantic judgment
   is unavoidable, the reviewer is a pinned model under a **strict,
   versioned review prompt** — rubric-anchored *binary* questions
   ("does module X own persistence?", yes/no) and **blind pairwise**
   verdicts, never holistic absolute scores (pairwise is markedly more
   reliable; surveys document reliability-without-validity failures of
   absolute judging). The prompt is a hashed artifact recorded per run;
   review settings are maximal-determinism (temp 0 where supported) but
   the layer is *treated as non-deterministic* — provider drift makes
   even temp-0 unfaithful, so verdicts are double-run for identity and
   any divergence voids the pair. Symmetric order debiasing, ≥3 pinned
   judge models, inter-rater κ reported, sub-threshold κ escalating the
   pair to human review. Raw reviewer transcripts are first-class
   artifacts. Verdicts carry a `judgement` provenance tag and never
   enter the executed pass-rate tables.

**The grading standard artifact.** All readability/design rules the
layers grade against live in a single versioned document —
`benchmarking/grading-standard.md` — where every rule (R1–R5 readability,
D1–D5 design) declares its lineage (primary source and evidence,
labeled empirical vs. consensus) and its scoring method with its grader
class. The determinism boundary runs through that file, not through
discussion: det rules are compiled to LSP/executed checks, rev rules
become the reviewer's binary rubric questions, generated *from the same
file*, so every judgment in a transcript cites a rule ID.

**Calibration anchor (sample, human).** A stratified sample (~10–15%) is
blind-reviewed by expert humans; rank correlation (Spearman) is reported
between the human ranking and both of layers 1 and 3. Layer 1 carries
the primary design claims; layer 3 resolves disagreement. This is what
makes "tight" survive an audit: every design number names its grader
class.

### Execution design

- **Interleave, don't block.** Replicates run round-robin across arms
  (A,B,C,A,B,C…) within one operator session, never all of A then all of B —
  provider-side model drift intraday is the single largest external threat,
  and interleaving makes it shared variance instead of bias.
- **Replicates: k=3 per problem per arm** even at temperature 0; API
  nondeterminism (batching, numeric drift, provider load) survives temp-0
  and only replicates expose it.
- **Fresh state per attempt.** Every attempt gets a fresh container and
  worktree; no caches, no session state, no warm anything carries across
  attempts.
- **One driver.** A single `run.py --harness X --problem-set v1
  --replicate N` command fans out the whole matrix; per-harness logic lives
  behind a thin adapter interface so all runner code is shared across arms.

### Reproducibility — the run manifest

Every attempt is issued under a `run-manifest.json` that pins and records:
harness name + git SHA, model version string + provider endpoint, sampling
parameters, problem-set version + task ID + container image digest,
replicate index, start/end timestamps, a provider-latency fingerprint
(a cheap probe at run start and end) so a drifted provider is *detectable*
after the fact rather than merely suspected, plus the grader-side pins:
language-server name+version for the LSP design metrics, the review
prompt SHA-256 for the judgment layer, and the grading-standard document
SHA-256 that defines the rules being graded.

### Data collection — the contract ("super ultra tight")

- **Append-only dataset.** Raw artifacts are written once and never
  post-processed in place. Results directory is version-controlled (or
  DVC-managed if transcripts are heavy). Analysis scripts read; nothing
  mutates.
- **Atomic record: one JSONL line per attempt**, fields fixed before the
  first run:
  `problem_id, suite, harness, harness_sha, model, model_version,
  sampling_params, replicate, outcome, outcome_class, tokens_in,
  tokens_out, turns, tool_calls, wall_time_s, cost_usd, started_at,
  ended_at, manifest_path, transcript_path, grader_version`.
- **Failure taxonomy, structured, never collapsed.** `outcome_class ∈
  {pass, fail, harness_error, timeout, grader_error}`. A harness crash is
  never silently counted as a wrong answer; a grader bug is never counted
  as either.
- **Retry rule, pre-registered.** Harness-side infrastructure errors retry
  at most twice; every retry is its own recorded attempt and the original
  record is retained. No other retries. No exceptions are invented later.
- **Grader determinism check.** Grading is run twice on a sample of
  attempts; identical outcomes required before results ship. A manual
  spot-check sample is recorded with reviewer initials.
- **Full transcripts preserved** per attempt, referenced by path in the
  atomic record, never edited.

### Analysis

Primary metric: pass rate per arm with Wilson confidence intervals.
Secondary: tokens, wall-time, turns, cost *per solved problem*. The design
is paired (same problems across arms), so the inferential test is McNemar
(or a paired bootstrap on per-problem outcomes) — that pairing is where the
statistical power comes from. Report effect sizes with CIs, never lone
p-values. One analysis script produces the entire report; no number is
hand-assembled.

## Alternatives considered

- **SWE-bench Verified.** Rejected: contamination is confirmed across all
  frontier models (verbatim gold-patch recall in audits), the ~80% ceiling
  leaves almost no room to discriminate harnesses, and it is Python-only.
  It would mainly measure memorization plus saturation noise.
- **SWE-bench Pro alone / as primary.** Attractive scale (~730 public
  instances), but its evaluate-a-git-diff harness forces an artificial
  workflow onto agent harnesses and per-language Docker setup is heavy; as
  the *only* suite it also misses agentic execution breadth. Kept as the
  secondary scale anchor instead.
- **Terminal-Bench 4.0.0 alone.** Best harness fit, but 66 tasks limits
  statistical resolution on small effects; pairing with Pro's larger
  instance count fixes that.
- **MLE-bench / RE-Bench / PaperBench.** Different domain (ML engineering,
  research-replication); they measure the model's research craft more than
  the harness's software-engineering plumbing. Out of scope for this
  experiment.
- **Custom internal tasks only.** Maximum control and zero control over
  external validity: nothing to anchor to, easy to accidentally tune to
  one harness's strengths. Kept as an optional later addition, not a
  substitute for a public suite.
- **Holistic absolute LLM scoring (1–10 rubric totals).** Rejected:
  judge-reliability studies show absolute scores are the least reliable
  judging form (drift, position and verbosity biases, unreliable
  calibration) — pairwise-relative is what survives scrutiny, which is
  why judgment lives only in the quarantined layer-3 pairwise protocol.
- **Pure static-metrics design grading.** Rejected as a sole instrument:
  modularity counts are gameable and ignorant of intent, so they ship as
  telemetry (layer 2), never as the design verdict.
- **LLM-judge grading.** Rejected for the primary pipeline: executed
  test-based graders are deterministic, re-runnable, and auditable.
  Judgment is admitted only through the layer-3 quarantine above —
  pinned, pairwise, double-run, κ-gated, and labeled as judgment data.

## Acceptance criteria

1. This note plus a `benchmarking/` scaffold exists: problem-set manifests
   (schema fixed), per-harness adapters, single driver command, results
   tree, analysis script skeleton, and a pre-registered `DECISIONS.md`
   containing the retry rule, budget policy, and failure taxonomy.
2. Terminal-Bench 4.0.0 and SWE-bench Pro public split are fetched and
   pinned (commit SHA / dataset revision recorded in their pin manifests);
   at least one smoke task per suite runs end-to-end per arm and emits a
   complete JSONL record plus preserved transcript. (Terminal-Bench 4.0.0
   is already fetched and pinned — acceptance 2 is half-done.)
3. The grader-determinism double-run passes on the smoke sample, and a
   spec-delta dry run on one design-slice task produces a complete
   three-layer record (executed penalty metrics, pairwise judgment with
   κ, provenance tags intact).
4. A full pilot (`k=3` replicates, a stratified slice of ≥20 tasks × all
   arms) completes with zero unclassified outcomes — every attempt lands
   in exactly one `outcome_class`.

## Risks

- **Provider/model drift over the benchmark window** — mitigated by arm
  interleaving plus the latency fingerprint in the manifest, but a
  multi-day full run can still straddle a provider-side model update;
  the manifest makes it measurable, not avoidable.
- **Ceiling/floor risk**: if a slice saturates (all arms pass) or floors
  (all fail), it yields no discrimination; stratified slices and the
  paired design are the defense, plus the headroom facts behind the
  suite choices.
- **Cost**: three suites × k=3 × multiple arms on hard tasks is real spend;
  the pilot acceptance criterion exists to price this before the full run.
- **What we knowingly give up**: equal-budget comparability as the primary
  lens (replaced by harness-natural + cost-as-metric), any coverage of
  non-coding agent workloads, and LLM-judge nuance — traded for
  determinism and auditability.
