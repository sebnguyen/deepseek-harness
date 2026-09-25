# Declared Verification Claims

The claim seam — an advisory turn-verification policy in which the agent opens each work turn with immutable declarations of what must be true when the turn completes, each bound to one shell verifier. The model runs those verifiers itself with `run_claim`, and the turn boundary runs whatever it left open. It composes on three extension points that already exist: the [system prompt](system-prompt.md) carries the standing demand, the [tool registry](../../packages/core/tools) carries the `declare_claim`, `run_claim`, `list_claims`, and `abandon_claim` tools, and an `agent/pre-step` listener appends a plugin-sourced reminder at each turn's first step so the boundary is model-visible, and the loop's serial `agent/turn-stopping` point carries settlement. The group never modifies the agent-loop and never gates a tool call or a capability; the declaration is a commitment the model makes and the log records, not an enforcement the harness performs. Design authority: the [declared verification claims Agent Note](../../.agents/notes/implemented/architecture/2026-09-19-declared-verification-claims.md).

Source: [`packages/claim/claim/src/index.ts`](../../packages/claim/claim/src/index.ts)

## The claim

`ctx.claims` (`ClaimService`) holds the immutable claims of the open turn — any number of them, one per independent condition — each identified by its own `turn` field. `openClaims` reads that turn's pending claims and `turnClaims` every claim it declared, so a turn whose declaration messages left the transcript through compaction still settles the claims the session log records.

```ts type-equiv
/** Full durable state of one claim, scoped to the turn that declared it. */
interface Claim {
  /** Stable claim identity. */
  readonly id: ClaimId
  /** Turn this claim belongs to; a turn declares any number of claims. */
  readonly turn: number
  /** Positive revision; every durable mutation increments it. */
  readonly revision: number
  /** Short label for this claim, for human reading. */
  readonly title: string
  /** What must be true when this claim is settled, for human reading. */
  readonly description: string
  /** The one frozen predicate that decides this claim. */
  readonly verifier: Verifier
  /** Every recorded execution, in order. */
  readonly results: readonly VerifierResult[]
  /** Lifecycle state; `pending` exactly while the claim is open. */
  readonly settlement: ClaimSettlement
}
```

A claim records `title` (a short label), `description` (what must be true when it is settled), exactly one `verifier` — a shell script frozen by SHA-256 at declaration — every recorded verifier `result`, and a `settlement` that starts `pending` and ends `passed`, `tampered`, or `blocked` with one of three codes (`abandoned`, `repair-budget-exhausted`, `verifier-unavailable`). `run_claim` runs a claim's verifier inside the turn and settles it as `passed` on exit code 0; a recorded `tampered` binding settles immediately. `abandon_claim` is refused until the bound verifier has run at least once, through `run_claim` or the turn boundary. There is no amend operation: a claim that named the wrong condition is abandoned, never corrected, because allowing a rewrite would reopen the "fail, then redefine success downward" path that immutability closes.

## Durable records

The [session log](session.md) is the only store. `claim/declared`, `claim/result`, and `claim/settled` are log-only events with no `surfaceOp`, so no claim field reaches a model request; the model sees claims only through the `tool-claim` schemas, the standing demand section, and steered settlement evidence. The strict fold validates non-empty `title` and `description`, one frozen verifier, the closed outcome and settlement sets, and monotonic revisions, and rejects a malformed event before commit. The `claim` [projection unit](session-projection.md) serves the folded `Claim[]` to client carriers; mounting `dsh-claim` alone stores and serves claims without running or prompting anything.

## Settlement

The `claim-settlement` listener runs every claim still open at `agent/turn-stopping`, the loop's serial pre-boundary point. A `pass` settles the claim; a `tampered` script blocks without retry; a `fail` steers bounded evidence back for repair while `repairBudget` remains — one repair round by default — and blocks once it is spent; an `inconclusive` run — the executor killed it or it could not run — retries the verifier without consuming the model's repair budget. The listener never throws, so a settlement failure degrades to a `blocked` settlement instead of closing the turn as an error. The [package README](../../packages/claim/claim-settlement/README.md) owns the configuration detail.
