# Agent Note: Explore reminder discloses the stage's read-only sandbox gate

Status: implemented

## Problem

The explore stage clamps `sandbox-policy/resolve` to the stage's `read-only` fence, yet the explore description named the stage's probe tools and never said that fence existed, while the runtime-context snapshot keeps rendering the session's standing policy — deliberately, so `sandbox:policy` prompt bytes stay identical across per-call clamps. A session configured `danger-full-access` therefore read "Current DSH file policy: danger-full-access" while every `multi_bash` and `multi_write` call ran confined read-only. The observed failure was a turn that took pnpm's `EROFS` as a host misconfiguration, spent several calls diagnosing store and temp paths, and then retried with `sandbox_permissions: workspace-write` — routing through the approval channel and dying on its rejection — while `request_escalation`, the intended crossing, was never considered.

## Decision

The shipped explore-stage `description` in `@deepseek-ai/dsh-staged-escalation` now states that the stage holds the shell and file tools at the read-only sandbox even when the session's configured file policy is wider, names a sandbox denial and a raw `EROFS` as the clamp's signature rather than a misconfiguration, and names `request_escalation` as the lever that widens the fence — with the one-sentence note that `sandbox_permissions` still routes through user approval and lifts nothing beyond a single command. The step-1 reminder injects the description verbatim, so the disclosure reaches every locked turn without touching the `reminderText` skeleton, `denyReason`, or the `staging:core-rule` section, and the recorded-session expectations that embed the reminder are refreshed with it. This extends the copy family that [request_escalation grants without explore evidence](../../simplification/2026-10-05-request-escalation-anytime.md) tracks; the clamp itself stays as [staged tool-tier escalation](../../proposed/feature/2026-10-05-staged-tool-tier-escalation.md) describes it.

## Alternatives considered

- **Put the disclosure in the `reminderText` skeleton line.** Rejected because the skeleton is stage-generic and already names the fence value (`The file and shell fences hold at read-only`); the explanation connecting the clamp to the configured policy, `EROFS`, and `sandbox_permissions` belongs to the explore stage's rationale-led description, which per [staged tool-tier escalation](../../proposed/feature/2026-10-05-staged-tool-tier-escalation.md) is the deployment-authored encouragement the reminder injects.
- **Render the clamped mode in the runtime-context snapshot.** Rejected because `SandboxPolicyService` renders the standing policy so the `sandbox:policy` prompt bytes stay identical across per-call clamps; reporting the per-stage effective mode there forfeits that cache property to duplicate what the reminder now says once per locked turn.
- **Deny `sandbox_permissions` outright during explore.** Rejected because it deletes the human-approval escape the escalation vocabulary exists for; the disclosure teaches the cheaper lever instead of removing the expensive one.

## Consequences

Every locked turn's step-1 reminder reconciles the read-only fence with the configured policy the runtime context reports, so a failing write during explore resolves to "cross with `request_escalation`" instead of host diagnosis or a dead-end approval ask. The cost is two sentences on the step-1 message of every turn that starts from explore — the same cache-prompt position the description already occupies — and a one-time refresh of every snapshot expectation that embeds the reminder.
