# Agent Note: observing job output without consuming it

Status: implemented

## Problem

A job's output was reachable one way: `JobRegistry.read` advanced a single consuming cursor, or `readOutput` produced a delta. That cursor belongs to the model — `job_output` is what turns job output into a tool result — so anything else that wanted to follow a running job's output would have taken bytes the model was still owed. A browser view, a status line, or a live tail could therefore only be built by stealing the model's stream, or by waiting for settlement and reading the retained copy afterwards.

The second consumer this blocks is the one about to exist: the Web client's per-job detail view and the session-control frame that feeds it.

## Decision

`JobHooks` gains an optional `readLines(from)`: retained output lines by absolute index, served without touching the consuming cursor. `JobRegistry.readLines(id, caller, from)` projects it with the same owner fencing as every other operation, and deliberately does not mark the job reported — an observer watching output is not the model learning the result, so the completion notice stays owed.

Indices are absolute over the work's own line stream, and the producer reports `truncated` when the caller asked for a line it has already dropped. A buffer that trims from the front therefore never silently shifts a caller's cursor onto different lines; a relative window would have. The producer that can answer this is the one holding an addressable buffer — the persistent shell's job, whose retained text is already re-derived from the terminal's line-addressed scrollback on every poll.

Absence is meaningful, not a degradation: a producer whose output exists only as a stream (a pipe-backed command, a subagent) omits `readLines`, and `JobRegistry.readLines` returns undefined for it. The surface is the producer's to provide, exactly as `readOutput` already is.

## Alternatives considered

- **Let observers call `read` and re-publish what they consumed.** Rejected: it spends the model's cursor on a viewer's behalf, so a browser tab open on a background job would silently empty the tool result the agent later reads.
- **Have `read` return a copy to every caller.** Rejected: `read`'s single cursor is what makes a stream delta well-defined. Two consumers of one delta cannot each receive "since the previous read" — the second read is empty by construction.
- **Read from the terminal service directly in the observer.** Rejected because the browser and the frame publisher have no terminal session: they hold a job id, and the owner fencing that makes a job readable lives in the registry.
- **Push only the settled output.** Rejected because it answers the wrong question: the reason to open a running job's output is that it is still running.

## Consequences

The model's own path is the plain snapshot beside the bounded blocking read of [bounded job_output waits](2026-09-30-bounded-job-output-wait.md); this read is the observer's path beside both.

The registry's `readLines` is the second non-consuming surface beside `get`/`list` snapshots, and the only one carrying bulk text; a caller that polls it must hold its own cursor, which is why the return value carries `next` rather than a page ordinal.

Output becomes readable while a command runs only once the tool's send has settled at least once — the retained text is re-derived on the tool's poll cadence, and a send settles on the backend's silence window or on completion. A command shorter than that window publishes its output in one step, which is a property of the existing streaming path rather than of this read.

## Testing

`packages/jobs/jobs-local/tests/jobs.spec.ts` pins the registry contract: an absolute-index page, repeatability for an unchanged cursor, that a later cursor sees only what followed it, that the model's own consuming read still returns the whole stream afterwards, that a dropped line is reported rather than silently skipped, that a foreign observer is refused, and that a producer without an addressable buffer yields undefined. `packages/shell/tool-bash-persistent/tests/background.spec.ts` proves it end to end through a real Loader composition: an observer reads the first line while the command is still running, a cursor taken then reads only the line that followed, and the model's `job_output` still receives both.
