# Agent Note: Claim chip follows the session's pending claim, not its owning turn

Status: implemented

## Problem

The Web GUI claim chip surfaced each turn's claim by matching the claim ledger entry whose `turn` equals the owning Turn's location. That tied the chip to a turn identity the UI could not always resolve cleanly — a claim declared in the current turn could fail to appear when the message/turn mapping did not line up — and it meant the settled verdict chip lived scattered across finished turns.

## Decision

`ClaimAction` in `dsh-client-ui-claim` no longer selects claims by turn. It reads the `claim` projection and renders the session's **current pending claim** (`settlement.kind === 'pending'`), regardless of which turn declared it; when no claim is pending it renders nothing. While the session runs, the same pending claim therefore appears in every turn's assistant action row and, above the composer, in `ClaimDock`. The verdict-specific chip presentations (`passed`, `blocked`, `tampered`) remain on the exported `ClaimChip` component for direct render consumers, but the action row no longer shows settled verdicts.

## Alternatives considered

- **Fall back to the owning turn's settled claim once no claim is pending.** Rejected: it kept a turn-matching path alive for the settled case, reintroducing the very turn-identity coupling this change removes, and the settled verdict would reappear inconsistently depending on how many turns were rendered.

## Consequences

A pending claim is now always visible while work is in flight, independent of turn-to-message bookkeeping. The cost is that settled verdicts no longer persist in the chat surface — a failed or tampered claim's durable state remains in the session log and in the claim tooling, but is no longer rendered in the finished turn's action row.
