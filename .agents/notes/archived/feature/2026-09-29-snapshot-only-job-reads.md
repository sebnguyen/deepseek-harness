# Agent Note: snapshot-only job reads

Status: implemented
Archived: 2026-09-30

English | [中文](2026-09-29-snapshot-only-job-reads.zh.md)

## Problem

`job_output` accepted `wait: true` with an optional `timeout_ms`, blocking the step until the job settled or a deadline expired (`waitTimeoutMs`, capped by `maxWaitTimeoutMs`). That parameter existed because a blocking read was once the only way for a model to learn a background job had finished. The completion notice superseded it: [background job completion wakes an idle owner](2026-08-11-background-job-completion-wakes-an-idle-owner.md) made settlement reach the owning agent as an in-session message, and the surrounding guidance was reduced to asking the model to use the blocking read "only when you are genuinely blocked" — a judgment call the mechanism imposed on its caller rather than answering itself.

A blocking read also contradicts what a job is for. The agent starts background work so it can keep working; a read that waits hands the waiting back to the agent at the one moment it deliberately avoided it, and it consumes the step that the completion notice was designed to make unnecessary.

## Decision

`job_output` takes exactly one parameter, `job_id`, and always returns the non-blocking snapshot: stream jobs return the output since the previous read, final-output jobs return their result once settled, and every response ends with `[status: ...]`. A run that finishes later reaches the agent through the existing completion notice — injected into the next-step inbox while the agent is busy, or a bounded follow-up wake while it is idle.

The `JobRegistry.wait` method is removed along with the local registry's waiter count, waiter resolvers, and settlement-time release. Terminal reads and cancellation remain the markers that set a record reported: a read that already returned the terminal state makes the completion notice redundant, and a job the model killed needs no completion message. The `waitTimeoutMs` and `maxWaitTimeoutMs` tool-jobs config fields existed only to bound the removed wait and are gone with it.

## Alternatives considered

- **Keep `wait: true` as an explicit opt-in for a genuinely blocked caller.** Rejected because the notice already answers the question it was kept for: a model that truly cannot proceed has the notice queued for its next step, and a model that can proceed should not be offered a control that stops it. Keeping both leaves two completion signals whose interaction — a wait that reports a job and suppresses its notice — has to be reasoned about on every read.
- **Remove the tool parameters but keep `JobRegistry.wait` as a seam method.** Rejected because it would leave a public method with no production consumer, and its waiter bookkeeping existed solely to mark a record reported when a wait delivered the terminal state. Terminal reads already carry that rule, so the method would be dead weight with a live-looking contract.
- **Reduce the wait to a short fixed timeout instead of removing it.** Rejected as a worse contract: a bounded blocking read still stalls the step, and a short bound turns "genuinely blocked" into a race against an arbitrary number.

## Consequences

A caller that still sends `wait` or `timeout_ms` gets an ordinary snapshot: the tool advertises neither, and undeclared arguments are ignored rather than refused, so the removed parameters degrade to a non-blocking read instead of an error. Tests that needed settled output — the one-shot background subagent cases and the shipped-composition background scenario — now wait for the record instead of asking a read to wait, which is the same ordering a real caller gets from the completion notice.

An observer that must follow output without spending the model's cursor reads lines instead: [observing job output without consuming it](2026-09-29-observing-job-output-without-consuming-it.md).

Removing the blocking read also removes the last production consumer of `JobRegistry.wait`, which is why the seam method and its bookkeeping are deleted in the same change rather than kept for compatibility.

## Testing

`packages/jobs/tool-jobs/tests/tool-jobs.spec.ts` pins the snapshot contract: a live read returns `[status: running]` without blocking, a settled read returns the final output, the removed parameters produce the same snapshot, and a live read no longer suppresses the completion notice. `packages/jobs/jobs-local/tests/jobs.spec.ts` and `packages/jobs/jobs/tests/service.spec.ts` cover the seam without the removed method.
