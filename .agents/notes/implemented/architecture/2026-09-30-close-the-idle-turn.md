# Agent Note: Close The Idle Turn core rule and promotion notice

Status: implemented

## Problem

Background work settles by calling back into the session: a foreground bash command promoted past `backgroundAfterMs`, an explicit `run_in_background` job, and a delegated subagent each deliver their result as an in-session notice, and when no turn is open that notice starts a new one. The rule set had no termination criterion for the waiting side. The `job_output` advice forbids busy-polling a job, and Prove It requires a coding turn to finish its own checks, but nothing states that a turn with nothing actionable left may simply end, so a model that delegated work either holds the turn open re-reading `job_output`, or manufactures filler work until the notice lands. The promotion acknowledgement said where the output goes but not that the wait itself is unnecessary.

## Decision

An eleventh Core Rule, `harness:core-rule:close-the-idle-turn`, closes the behavioral block at order 120, after `close-the-decision`, in [`core-guidance.ts`](../../../../packages/core/system-prompt/src/core-guidance.ts) and [`SECTION_ORDERS`](../../../../packages/core/system-prompt/src/index.ts). It opens with the reason (each callback opens its own turn, so a turn held open waiting on it earns nothing and invites polling), names the three callback sources (a command promoted past the shell timeout, a background job, a delegated subagent), states the obligation (when nothing pending remains that you can act on now, finish the reply and end the turn), and closes with a carve-out (a check or reply you still owe is pending work, not waiting) that keeps Prove It's in-turn verification boundary intact. The persistent bash promotion acknowledgement in [`tool-bash-persistent`](../../../../packages/shell/tool-bash-persistent/src/index.ts) appends a final line stating that the model may end its turn here when no pending task remains and that the completion is delivered automatically as a new turn, so the guidance arrives at the exact moment work moves to the background.

## Consequences

The per-section ceiling for the new section (744) and the aggregate ceiling (8322) are recorded in [`system-prompt.spec.ts`](../../../../packages/core/system-prompt/tests/system-prompt.spec.ts). Every `system-prompt.expected.md` sidecar carries the new rule after a keyless `test:snapshot:refresh`. The [oracle page](../../../../docs/subsystems/core-prompt-guidance.md) gains the order-120 row and the verbatim section, its Chinese pair updates the rule count and range (20–120, eleven rules), and the system-prompt README order range reads `10`–`120`. Like its siblings the section sits in the cache-stable prefix and disappears wholesale under `includeCoreRulesGuidance: false`.

## Alternatives considered

Folding the obligation into the `job_output` tool advice was rejected because Advice lines vanish when the jobs tool is not mounted and would not cover subagents. Folding it into Batch Over Individual was rejected because that rule governs parallel calls within one message, not turn termination. Putting the sentence only in the promotion acknowledgement was rejected because `run_in_background` jobs and subagents never surface a promotion notice, leaving the general obligation without a home; the notice line now mirrors the rule at the promotion point instead of replacing it.
