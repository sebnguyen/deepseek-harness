# Agent Note: bounded job_output waits

Status: implemented

## Problem

Snapshot-only `job_output` reads left a genuinely blocked agent with no way to wait: an agent that cannot proceed until a job settles must either end its turn and rely on the completion notice, or loop over snapshots. The notice path answers an idle owner with a woken turn, but a busy owner only claims the notice at its next step boundary, and a step that needs the result mid-flight paid one step per poll. The removal also discarded the bound that had made the historical blocking read safe: waits were defaulted and capped by plugin config, so a blocking call could not stall a step indefinitely.

## Decision

`job_output` regains its blocking read, now on every call: each read blocks until the job reaches a terminal status or a deadline, and `timeout_ms` is the only model-settable bound on one call. Two config fields bound every wait: `waitTimeoutMs` (default 10,000) applies when a read omits `timeout_ms`, and `maxWaitTimeoutMs` (default 60,000) clamps a larger model-supplied `timeout_ms` down to it; a `waitTimeoutMs` above the cap fails at load. A timed-out read returns the live snapshot with `[status: running]` and leaves the job alive; a read that reaches the terminal state returns the settled output and marks the job reported, suppressing the redundant completion notice the same way a terminal read does.

The tool delegates to the seam method `JobRegistry.wait`, which the process-local registry implements with per-job waiter bookkeeping: settlement releases live waiters before it announces completion, and pending waiters mark the record reported before listeners run, so a waiting reader and the notice never both deliver the same completion. The scoped deadline primitive distinguishes a wait timeout from caller cancellation, and the read honors `exec.signal` — a cancelled step rejects the wait only while the job is live, never cancelling the job itself. This reverses [snapshot-only job reads](../../archived/feature/2026-09-29-snapshot-only-job-reads.md); the non-consuming observer path of [observing job output without consuming it](2026-09-29-observing-job-output-without-consuming-it.md) is unchanged.

## Alternatives considered

- **Keep snapshot-only reads and let blocked agents poll.** Rejected: polling spends one step per read over unchanged state, and the notice a busy owner eventually claims arrives one step later than a bounded read would have returned the same result. The one-minute cap keeps the blocking read's price finite.
- **An optional or required `wait` flag beside the snapshot read.** Rejected: two read modes split one question — settle and give me the output — across two call forms, and the optional form auto-filled by clients recreates the blocking read without saying so. Always blocking states the blocking in the tool's one contract.
- **Restore the historical ten-minute cap.** Rejected: a model-chosen timeout must stay near step scale, so the shipped `maxWaitTimeoutMs` default is one minute; the field stays configurable for deployments that deliberately move the bound.

## Consequences

The completion notice remains the completion signal for reads that time out: a timed-out read leaves the notice owed, and only a kill, a terminal read (including a read that waited into the terminal state), or a teardown cancel marks the record reported. A timed-out read is a successful observation rather than an error — it returns `[status: running]`, so the tool owns its deadline instead of the generic tool-timeout policy, which would have replaced the observation with a timeout error. A blocked step pays at most the capped timeout, so the system-prompt guidance phrases collection as: collect still-relevant jobs with `job_output`, whose every read blocks until settlement or the bounded timeout and returns the live state for the notice to follow.

## Testing

`packages/jobs/tool-jobs/tests/tool-jobs.spec.ts` pins the tool contract: the schema exposes `job_id` (required) and optional `timeout_ms` only, a read against a live job expires at the configured bound and returns the live state, a read blocks until settlement and reports the terminal state, a model-supplied timeout above the cap clamps down to it, and a read that returned the terminal state suppresses the notice while a timed-out read still leaves it owed. `packages/jobs/jobs-local/tests/jobs.spec.ts` pins the seam: settlement resolves waiters reported, timeout resolves live without reporting, timed-out and aborted resolvers unregister while the job stays live, an abort racing settlement in the same tick removes the waiter before the notice is decided, and `wait` is fenced to the owning session. `packages/jobs/jobs/tests/service.spec.ts` covers the seam method on the stub registry.
