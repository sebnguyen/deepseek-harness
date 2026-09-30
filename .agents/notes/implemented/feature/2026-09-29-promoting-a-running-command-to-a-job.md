# Agent Note: promoting a running command to a job

Status: implemented

English | [中文](2026-09-29-promoting-a-running-command-to-a-job.zh.md)

## Problem

A persistent shell is the agent's only shell, and one command occupies it. A foreground command that runs long therefore costs twice: every later `bash` call queues behind it inside the tool's per-owner serialization, and the per-command deadline (`timeoutMs`) eventually closes the shell and destroys the work, because the deadline's only available action was to reset. The agent cannot hand a command it already started to `ctx.jobs` — `run_in_background` decides before the command exists — and it cannot kill and restart the work without losing it.

## Decision

A foreground command that outlives `backgroundAfterMs` (default `10000`) is retired into a background job instead of continuing to hold the shell. Nothing is moved or restarted: the command is already running in the session, so the job takes over its observation, completion, and closure while the work carries on, and the agent's next `bash` call spawns a fresh shell.

A second `bash` call arriving while a command runs lowers the bar to `contentionAfterMs` (default `1000`). The per-owner queue publishes the waiting call, and the holder re-races at the lower bar instead of making the caller wait out a command it no longer needs to watch. Contention clamps the bar rather than removing it, so a command that finishes inside it still serves its own caller with its own output, and the acknowledgement says the shell was needed rather than that the command was slow. `contentionAfterMs: 0` leaves only the threshold, and `backgroundAfterMs: 0` disables both.

The tool races the in-flight send against the threshold rather than signalling it. Losing that race abandons only the tool's observation — no signal reaches the command — which is what makes promotion possible at all: the deadline path it replaces reached for `reset`, and `reset` closes the session.

Registration precedes retirement. `ctx.jobs.start` runs first and only a successful registration calls `retire`, so a refused registration (the owner's job limit, or no attached controller) leaves the command running in the agent's own shell and the call completes normally. Retiring first would leave the agent with neither a shell nor a job.

`retire` is a new operation on the tool's owner-scoped shell registry, next to `get` and `reset`: it drops the owner's entry without closing the session, moving closure to the adopter. A refused promotion must also *resume the send it abandoned* rather than start a second one: a terminal session allows one active send, so a fresh `startSend` is rejected with `SEND_ACTIVE` and the failure path resets the shell — destroying the command the refusal was supposed to preserve.

The acknowledgement names the job, states that the shell was replaced, and points at `job_output`, so the model reads a deliberate handoff rather than a command that failed. The replacement-shell notice it includes is the same one an `exit` or a reset produces.

## Alternatives considered

- **Promote on contention instead of on a threshold.** Superseded by shipping both: contention is now the second trigger, and the per-owner queue publishes it. Kept as a record of why the signal was wanted before it existed.
- **Keep the deadline and kill at the threshold.** Rejected: it destroys builds, test runs, and installs, which is the outcome promotion exists to avoid.
- **Move the half-finished command into a new background session.** Rejected as impossible: a running process cannot be reparented into another PTY, and restarting it would redo side effects.
- **Start the command in its own session and leave the agent's shell alone.** Rejected because the command would lose the shell state that made the persistent shell worth having — an `export`ed environment, an activated virtualenv, a `cd`ed directory — and the agent would silently get a different environment than the one it built.

## Consequences

Promotion only fires while `backgroundAfterMs` is below `timeoutMs`; at or above it the deadline still ends the command first, which the README states. A promoted command's shell keeps the state the agent no longer shares, so the handoff reports the replacement rather than leaving the model to infer it. Commands that finish inside the threshold are unaffected, so short commands keep their output in the tool result.

The threshold is deployment configuration with a 10-second default. Recorded sessions that ran a command longer than that now observe an acknowledgement where they recorded command output, so their expectations are part of the pending snapshot re-record.

## Testing

`packages/shell/tool-bash-persistent/tests/promotion.spec.ts` proves both halves against a real Loader composition: a command that outlives the threshold returns the acknowledgement, its output arrives through `job_output` after the handoff, and the next `bash` call finds the exported state gone; with the owner's job limit exhausted, the command completes in the foreground with its exit status and no second job is registered; a second call queued behind a live command retires it with the contention acknowledgement while a command that finishes inside the contention bar is served in the foreground. `background.spec.ts` continues to cover the `run_in_background` path that shares the same job hooks.
