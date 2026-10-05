# Agent Note: Explore batch fan-out with cap-counted tasks

Status: implemented

## Problem

Parallel exploration depended on the model batching several delegation tool calls in one assistant message, and nothing enforced batching: a model that serialized `explore` calls paid one blocking wait per child. `workflow` also fans out, but it hands the orchestration to a JavaScript script a research task does not need, and the `explore` row itself exposed only a single `prompt` parameter.

## Decision

**One `explore` call runs several children, through `tasks` alone.** `dsh-tool-subagent` gains the opt-in `enableBatchTasks` config field; enabled instances replace `prompt` with a required `tasks` array of `{description, prompt}` entries instead of offering both spawn shapes, and one foreground call starts one child per entry in parallel with the same per-child defaults a single call applies. A batched call is foreground-only (background collection follows the single-prompt routes), and it reports `results` in task order — one entry per child carrying `description`, `status`, the child's text or `outputSchema` capture or its error. One failed child stays an error entry beside its siblings; all children failing throws those errors as an AggregateError. The shipped explorer row (`tool-subagent-explore` in the standard preset) enables it, so the standard composition gets enforcement by construction instead of by prompt instruction.

**The per-turn cap counts batch entries.** `dsh-delegation-cap` gains `batchParameter` (default `tasks`): a counted call whose logged arguments carry that array costs `1 + entries.length` starts, so a batch spends the per-turn budget in one call instead of routing around the cap that counts separate calls. The guard reads the logged `tool/call` arguments, which the session log already stores losslessly. Both shipped presets set the cap to twenty starts per turn, giving batched exploration its headroom while still braking true sprees.

**The turn-boundary reminder carries the exploration line.** `dsh-tool-claim` already injects a first-step reminder binding the declaration line to `declare_claim`; it now appends a second line, bound to `explore`, routing broad unknown reads to `explore` and naming the one-call `tasks` fan-out, because a turn that verifies code will declare claims and broad-reading turns should spend their reads on an explorer. A scope hiding both tools receives no reminder.

## Alternatives considered

**Prompt-only enforcement (tell the model to batch calls).** Rejected as the sole mechanism: the model may ignore instruction while a schema-level array cannot be ignored, and the deployment's spawn budget must hold either way.

**A separate `explore_batch` tool row.** Rejected: identical provider, child defaults, background rules, and cap accounting would duplicate per instance instead of reading from one config field on the existing row.

**Keep `prompt` beside `tasks` on batch-enabled instances.** Rejected as redundant: two parameters that each carry one child's prompt force the schema to police their exclusivity in prose while `tasks` covers the single-child call as a one-entry array; batch-enabled instances expose exactly one spawner.

**Counting a batched call as one cap start.** Rejected: the cap bounds children spawned per turn, not tool calls; a counted call carrying N children would otherwise start N children for one cap charge.

## Verification

Unit specs cover the required `tasks` shape of batch-enabled instances, per-child results in task order with per-entry render sections, empty- and batched-background rejections, per-child failure isolation beside a sibling, whole-call failure only when every child fails, the cap counting a two-entry batched call as three starts with the following single call denied, and the turn-boundary reminder's exploration line binding to `explore`. The `Explore Through Explorers` core rule states the `tasks` array and that the cap counts every child; the keyless snapshot refresh rewrites the prompt sidecars to it and the keyless replay verifies them, leaving only the pre-existing environment drifts (fs-edit, session-query-spill, subagent-tool-filter, image-compaction) and the pwsh-scenario sidecars that a pwsh-less host skips rather than refreshes. No recorded session registers the explore tool, so keyless fixtures never freeze its schema.
