# Agent Note: publishing job output on the control stream

Status: implemented

English | [中文](2026-09-29-publishing-job-output-on-the-control-stream.zh.md)

## Problem

The Web client could list a session's background jobs and their statuses, and nothing more: the `jobs` frame carries identity, kind, label, status, timestamps, and detail. A job's output was reachable only by the model, through `job_output`, so a person watching a running command had no way to see what it was doing — the one thing a background job's UI exists to show.

The control stream is the right carrier: it is already the pushed, generation-based channel for process-local state, and `jobOutput` needs no new transport, store, or Remote namespace.

## Decision

While at least one control stream is attached, the Session control controller publishes each visible job's new output lines as `jobOutput` frames on a configured cadence (`jobOutputPollMs`, default 250 ms; `0` disables publishing). The frame carries the lines, the absolute index one past them, and whether the producer dropped lines before they could be sent.

Publishing reads through `ctx.jobs.readLines` — the non-consuming line read added for exactly this observer ([observing job output without consuming it](2026-09-29-observing-job-output-without-consuming-it.md)). That is what keeps a live view from spending the model's `job_output` cursor: the browser and the agent read the same retained output through two independent paths.

Frames are bounded at 200 lines and the job's cursor advances by what was actually sent, so a burst larger than one frame continues on later ticks instead of being truncated away or sent as one unbounded frame. The cursor is per job and per controller (not per stream), it advances only while a stream is attached, and it survives stream churn: a re-attached stream resumes at the frontier rather than receiving a replay.

The browser mirrors those frames into a per-job buffer keyed by session, bounded at `JOB_OUTPUT_BUFFER_LINES` per job, holding absolute `first`/`next` indices rather than only the lines: a view can therefore tell that earlier lines left the buffer and read them back through the paged read, and a frame whose start does not continue the buffer re-anchors it instead of splicing unrelated lines onto lines the producer already dropped.

The browser renders what it mirrored: a job row is the control for its own job, and selecting one shows that job's lines in a panel under the list. The panel states when earlier lines were dropped rather than presenting the newest lines as the whole output, and it distinguishes a job that has produced nothing yet from one whose output exists only as the model's stream. Escape walks back one step per press — the panel, then the list — because a reader who opened two things expects to close them in that order.

A truncated page re-anchors: because a producer that dropped lines reports `truncated` and returns what it still retains, the cursor moves to the first retained line and the frame is flagged, so a consumer learns its earlier lines do not continue into this one.

## Alternatives considered

- **Push output as a Remote RPC the browser polls.** Rejected for live output: the stream already exists, already carries per-session job state, and already reconnects with a baseline. A poll loop in the browser would add a second, uncoordinated clock.
- **Put the accumulated output on the `jobs` frame.** Rejected: that frame is the visible *set*, sent on every registration, status change, and settlement. Carrying bulk text would make every lifecycle event pay for the output and would re-send it whenever anything changed.
- **Let the browser buffer grow with the job.** Rejected: a command that prints for an hour would grow browser state for as long as it runs. The buffer keeps the newest lines and says where the rest live.
- **Per-stream cursors.** Rejected as state that buys nothing here. A shared cursor gives every attached stream the same frames, and the case per-stream cursors would serve — a view opening onto output produced earlier — is a back-paging read rather than a live stream.
- **Publish every produced line in one frame.** Rejected: a command that prints a hundred thousand lines would arrive as one frame, and the frame is pushed to every attached stream.

## Consequences

The cadence is a deployment cost — a tick reads every visible job's retained window — so it is a `Config` field rather than a constant, and `0` turns it off for a deployment that would rather read on demand.

Output published before a stream attached is not replayed to it, so a browser that opens a job detail view late starts at the frontier. What it needs there is `session/jobOutput({ sessionId, jobId, from })`, the paged read beside this stream: it serves one bounded page of retained lines by absolute index and requires the owning Agent to be live, because jobs are keyed by owner. The two mechanisms divide the work — frames carry what a stream sees live, the read carries everything back to the oldest retained line.

A settled job still publishes its tail: publishing iterates the visible set rather than running jobs, so lines produced just before settlement arrive, and the cursor is pruned once the job leaves the set.

## Testing

`packages/api/session-controller/tests/control-jobs.host.spec.ts` covers the path against the real controller: a job's lines arrive with an advancing cursor and publishing then goes quiet; a 250-line burst arrives as bounded frames that deliver every line exactly once in order; a producer that drops lines yields a flagged frame whose cursor re-anchors past the gap; nothing is published when the cadence is disabled; and output produced before a stream attached arrives to it, because no cursor moved while nothing was attached. `packages/client/ui-activity/tests/activity-dock.client.spec.tsx` covers the view: a selected job row shows that job's lines with the dropped notice, an untouched job shows the empty copy, selecting again collapses the detail, Escape closes the drawer, and a job leaving the mirror takes its row with it. `packages/api/session-controller/tests/manager.client.spec.ts` covers the browser half: a contiguous frame extends a job's buffer with absolute indices, a frame after a reported gap re-anchors instead of splicing, a burst beyond the buffer bound keeps the newest lines and advances `first`, and a buffer is dropped with its job and cleared by a new generation. `packages/api/session-controller/tests/job-output.host.spec.ts` covers the paged read beside it: a cold view reading from the oldest retained line, paging back to a line the producer still retains, catching up with `lines: []`, one bounded page that a follow-up request continues, a producer with no addressable buffer reported rather than shown as empty, a reported gap that re-anchors the cursor, and the three refusals — a Session with no live Agent, an unreadable job, and a malformed cursor.
