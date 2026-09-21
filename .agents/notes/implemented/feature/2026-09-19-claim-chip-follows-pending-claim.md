# Agent Note: Claim chip is scoped to its owning turn and hides settled verdicts

Status: implemented

## Problem

The Web GUI claim chip surfaced each turn's claim by matching the claim ledger entry whose `turn` equals the owning Turn's location, and after settlement kept the verdict chip (passed / failed / tampered) visible on the finished turn. That left settled verdicts scattered across the chat. The turn-to-message mapping that carries the owning Turn's location into the action-row adapter is itself reliable — the claim's `turn` and the Turn location's number both derive from the same `turn/start` event, so matching them does not depend on message bookkeeping.

## Decision

`ClaimAction` in `dsh-client-ui-claim` selects the ledger entry whose `turn` equals the owning Turn's location **and** whose settlement is still `pending`. It renders that turn's pending claim chip; a turn that declared no claim, or whose claim already settled, renders nothing. The verdict-specific chip presentations (`passed`, `blocked`, `tampered`) remain on the exported `ClaimChip` component for direct render consumers, but the action row no longer shows settled verdicts.

## Alternatives considered

- **Follow the session's pending claim regardless of which turn declared it.** Rejected: the same pending chip then appeared on every turn's action row, so a prior turn still left `pending` (for example after an interruption) leaked its "Verifying claim" chip onto a brand-new turn that had declared no claim of its own.
- **Fall back to the owning turn's settled claim once no claim is pending.** Rejected: it would reintroduce settled verdicts into the chat surface, appearing inconsistently depending on how many turns render.

## Consequences

A pending claim is visible only on the turn that declared it, and disappears from the action row once it settles. The cost is that settled verdicts no longer persist in the chat surface — a failed or tampered claim's durable state remains in the session log and in the claim tooling, but is no longer rendered in the finished turn's action row.
