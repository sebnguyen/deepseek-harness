# Agent Note: persistent bash background jobs

Status: implemented

English | [中文](2026-09-29-persistent-bash-background-jobs.zh.md)

## Problem

The persistent `bash` tool serializes every command through one PTY per agent and closes that shell at the per-command deadline. A long build therefore has two bad outcomes: every later `bash` call queues behind it, or the deadline fires and the work is destroyed with its shell. The one-shot `tool-bash` offers `run_in_background` over pipes, but the persistent tool — the tool whose whole point is shell state — had no path into the `ctx.jobs` runtime that already owns completion notices, snapshot output reads, and the Web job surface.

## Decision

`dsh-tool-bash-persistent` registers `run_in_background` (config `enableRunInBackground`, default `true`). A background call:

- starts the wrapped command in its **own PTY session** through `ctx.terminals.spawn`, not the agent's persistent shell, so the command neither inherits nor disturbs the agent's shell state and the next `bash` call is never queued behind it — the call deliberately runs outside the per-owner command queue;
- registers with `ctx.jobs` as kind `bash` and returns `started background job <id>` immediately, the same acknowledgement text the one-shot tool emits, so consumers cannot tell the producers apart;
- reads output from the terminal scrollback, which is line-addressed and idempotent, rather than from a destructive delta cursor, and retains the final marker-free text at settlement so a `job_output` read that arrives after the session is released still serves the command's output;
- parses completion from the same START/END markers the foreground path uses, mapping a nonzero exit to `completed` with `exit code: N` detail exactly like the one-shot producer's outcome mapping.

The producer releases the background session when the job settles. Completion reaches the agent through the existing `ctx.jobs.onJobDone` listener — a next-step inbox entry while busy, a wake while idle — so no callback machinery was added.

### Package facts

`@deepseek-ai/dsh-jobs` is a peer dependency for the `ctx.jobs` type merge and `packages/shell/tool-bash-persistent/tsconfig.json` references `../../jobs/jobs`; `dsh-jobs-local` and `dsh-tool-jobs` are dev dependencies for the real-composition spec.

## Alternatives considered

- **Run the background command in the agent's persistent shell and retire it.** Closer to the intended promotion design, where a deadline or contention turns the agent's own shell into a job. Rejected for this change because it would silently reset the agent's cwd and environment on an ordinary `run_in_background` call and because it needs the `retire` ownership-transfer operation that does not exist yet; a dedicated session keeps this call's semantics explainable and leaves promotion as its own layer.
- **Reuse the one-shot `tool-bash` producer.** It executes over pipes with a fresh shell per call and carries sandbox-escalation machinery the persistent tool does not mount. Rejected to keep exactly one execution path behind the persistent tool's `bash` name.

## Consequences

A background command does not inherit the agent's shell state, and the tool's parameter description says so. Output survives the settlement-time session release through the producer's retained buffer, bounded by the terminal scrollback at the last refresh; a sliding scrollback window re-anchors rather than replaying consumed text. The shipped `standard` preset swap from one-shot to persistent bash keeps the preset-plane-to-host-registry linkage: the background scenario in `apps/web/tests/shipped-composition.e2e.ts` passes unchanged.

Companion changes: [promoting a running command to a job](2026-09-29-promoting-a-running-command-to-a-job.md) hands an in-flight foreground command to this same job machinery, and [bounded job_output waits](2026-09-30-bounded-job-output-wait.md) bounds every blocking `job_output` read while in-session notices remain the completion signal for timed-out reads.

## Testing

`packages/shell/tool-bash-persistent/tests/background.spec.ts` boots a real Loader composition (terminal-bash, subprocess-local, jobs-local, tool-jobs) and proves the acknowledgement text, `job_list` visibility, a post-settlement `job_output` read, and that the agent's shell keeps its exported state across the background call. `apps/web/tests/shipped-composition.e2e.ts` pins the shipped preset linkage.

## Related

The persistent shell itself, and the interactive-terminal scope it deliberately defers, belong to [persistent PTY sessions](2026-07-16-persistent-pty-sessions.md). Completion notices, snapshot reads, and the Web job surface belong to `packages/jobs`.
