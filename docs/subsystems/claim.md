# Declared Verification Claims

The claim seam — an advisory turn-verification policy in which the agent opens each work turn with an immutable declaration of why the turn exists and what must be true when it completes, bound to one shell verifier that the turn boundary runs. It composes on three extension points that already exist: the [system prompt](system-prompt.md) carries the standing demand, the [tool registry](../../packages/core/tools) carries the `declare_claim` and `abandon_claim` tools, and an `agent/pre-step` listener appends a plugin-sourced reminder at each turn's first step so the boundary is model-visible, and the loop's serial `agent/turn-stopping` point carries settlement. The group never modifies the agent-loop and never gates a tool call or a capability; the declaration is a commitment the model makes and the log records, not an enforcement the harness performs. Design authority: the [declared verification claims Agent Note](../../.agents/notes/implemented/architecture/2026-09-19-declared-verification-claims.md).

Source: [`packages/claim/claim/src/index.ts`](../../packages/claim/claim/src/index.ts)

## The claim

`ctx.claims` (`ClaimService`) holds one immutable claim per turn, identified by its own `turn` field.

```ts type-equiv
/** Full durable state of one claim, scoped to the turn that declared it. */
interface Claim {
  /** Stable claim identity. */
  readonly id: ClaimId
  /** Turn this claim belongs to; a turn declares at most one. */
  readonly turn: number
  /** Positive revision; every durable mutation increments it. */
  readonly revision: number
  /** Why this turn is being worked, for human reading. */
  readonly purpose: string
  /** What must be true when the request is complete, for human reading. */
  readonly satisfy: string
  /** The one frozen predicate that decides this claim. */
  readonly verifier: Verifier
  /** Every recorded execution, in order. */
  readonly results: readonly VerifierResult[]
  /** Lifecycle state; `pending` exactly while the claim is open. */
  readonly settlement: ClaimSettlement
}
```

A claim records `purpose` (why the turn exists), `satisfy` (what must be true when it completes), exactly one `verifier` — a shell script frozen by SHA-256 at declaration — every recorded verifier `result`, and a `settlement` that starts `pending` and ends `passed`, `tampered`, or `blocked` with one of three codes (`abandoned`, `repair-budget-exhausted`, `verifier-unavailable`). A second declaration in the same turn is refused; `abandon_claim` is refused until the bound verifier has run at least once. There is no amend operation: a claim that named the wrong condition is abandoned, never corrected, because allowing a rewrite would reopen the "fail, then redefine success downward" path that immutability closes.

## Durable records

The [session log](session.md) is the only store. `claim/declared`, `claim/result`, and `claim/settled` are log-only events with no `surfaceOp`, so no claim field reaches a model request; the model sees claims only through the `tool-claim` schemas, the standing demand section, and steered settlement evidence. The strict fold validates non-empty `purpose` and `satisfy`, one frozen verifier, the closed outcome and settlement sets, and monotonic revisions, and rejects a malformed event before commit. The `claim` [projection unit](session-projection.md) serves the folded `Claim[]` to client carriers; mounting `dsh-claim` alone stores and serves claims without running or prompting anything.

## Settlement

The `claim-settlement` listener runs the bound verifier at `agent/turn-stopping`, the loop's serial pre-boundary point. A `pass` settles the claim; a `tampered` script blocks without retry; a `fail` steers bounded evidence back for repair while `repairBudget` remains and blocks once it is spent; an `inconclusive` run — the executor killed it or it could not run — retries the verifier without consuming the model's repair budget. The listener never throws, so a settlement failure degrades to a `blocked` settlement instead of closing the turn as an error. The [package README](../../packages/claim/claim-settlement/README.md) owns the configuration detail.
