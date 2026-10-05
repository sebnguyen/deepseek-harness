# Agent Note: request_escalation grants without explore evidence

Status: implemented

## Problem

`request_escalation` refused the act stage unless the turn's log already held a successful lower-stage tool result. The mechanical answerer compared that evidence fold with the requested tier and delegated to the rest of the approval waterfall when the fold was short. A turn that already knew what to change — a user message that named the file, a continuation of work just read, a fix with no workspace unknown — still had to spend a probe call before the crossing would grant. The refusal text blamed missing explore evidence, so the model treated the probe as a precondition rather than as optional preparation.

## Decision

`request_escalation` in `@deepseek-ai/dsh-staged-escalation` returns the granted stage from the tool itself. It does not call `approval.request`, does not read the session log, and does not require a prior successful explore-stage call. Act-stage tools stay denied until that call's grant is logged; the narrow-only sandbox clamp still follows `currentStage`. Each user message still re-arms the ladder at explore.

The explore-stage description, the step-1 reminder, the tool description, and the `staging:core-rule` section state that the call grants immediately. `evidenceStage` is removed. Approval policy does not apply to the crossing: `ApprovalService` returns `rejected` for policy `never` before it dispatches `approval/request`, which is why an answerer cannot be the grant.

This reverses the evidence precondition in [staged tool-tier escalation](../../proposed/feature/2026-10-05-staged-tool-tier-escalation.md). The denial of act tools before a logged grant, and the clamp, stay as that note describes them.

## Alternatives considered

- **Keep the evidence check and only soften the prompt.** Rejected because the answerer, not the prompt, was the restriction. Copy that says the agent may cross anytime is false while the answerer still declines.
- **Skip `request_escalation` and start every turn in act.** Rejected because the user asked to remove the evidence precondition, not the stage border. Act tools remain one visible crossing away.
- **Grant from an `approval/request` listener.** Rejected because policy `never` returns `rejected` inside `ApprovalService` before any listener runs, and an ACP or human answerer registered earlier can decline the ask. The tool result is the grant.

## Consequences

A turn can enter act before any read, search, or question. The cost is the write-spree failure the evidence check was meant to block: the model can cross and then spend the turn on writes built on an unverified premise. The denial still fires on an act tool issued before the crossing, and the grant stays a logged tool result, so the crossing remains visible and still resets on the next user message.
