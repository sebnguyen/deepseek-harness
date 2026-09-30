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

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxclaims--claimservice"></a>

### `ctx.claims` — `ClaimService`

Claim service (`ctx.claims`) backed exclusively by the owning session log.

```ts cordis-catalog
/**
 * Read every claim of the open turn, pending or settled, in declaration order.
 * @param agent - owning live agent.
 * @returns the open turn's claims; empty when that turn declared none.
 * @throws {@link ClaimError} when no model turn is open or the agent is not live.
 */
turnClaims(agent: Agent): readonly Claim[]

/**
 * Read every currently-pending claim of the open turn, in declaration order.
 * @param agent - owning live agent.
 * @returns the open turn's pending claims; empty when that turn declared none or settled every claim.
 * @throws {@link ClaimError} when no model turn is open or the agent is not live.
 */
openClaims(agent: Agent): readonly Claim[]

/**
 * Read every claim this session declared, in turn order.
 * @param agent - owning live agent.
 * @returns the turn-ordered ledger, empty before the first declaration.
 */
ledger(agent: Agent): readonly Claim[]

/**
 * Count recorded failures for one claim.
 * @param agent - owning live agent.
 * @param id - the claim to count for.
 * @returns how many recorded results on that claim carry outcome `fail`.
 */
failures(agent: Agent, id: ClaimId): number

/**
 * Declare one claim in the currently open turn. A turn may declare any
 * number of claims; each is immutable and settles independently.
 * @param agent - owning live agent.
 * @param request - the claim's title, description, and bound verifier script.
 * @returns the freshly declared claim.
 * @throws {@link ClaimError} when no turn is open or the request is invalid.
 */
declare(agent: Agent, request: DeclareClaimRequest): Claim

/**
 * Record one verifier execution against a claim.
 * @param agent - owning live agent.
 * @param id - the claim to record against.
 * @param result - the execution outcome and its bounded evidence.
 * @returns the advanced claim.
 * @throws {@link ClaimError} when the claim is unknown, not in the open turn, or settled.
 */
record(agent: Agent, id: ClaimId, result: VerifierResult): Claim

/**
 * Close one claim with a terminal settlement.
 * @param agent - owning live agent.
 * @param id - the claim to settle.
 * @param settlement - the terminal settlement to commit.
 * @returns the settled claim.
 * @throws {@link ClaimError} when the claim is unknown, not in the open turn, or settled.
 */
settle(agent: Agent, id: ClaimId, settlement: ClaimSettlement): Claim

/**
 * Abandon one claim as the model conceding it named the wrong condition.
 * Refused while the bound verifier has not yet run, so a claim cannot be
 * opened and closed without facing its check at least once.
 * @param agent - owning live agent.
 * @param id - the claim to abandon.
 * @param message - non-empty explanation recorded with the abandonment.
 * @returns the settled claim.
 * @throws {@link ClaimError} when the claim is unknown, not in the open turn, settled, or its check has not run.
 */
abandon(agent: Agent, id: ClaimId, message: string): Claim
```

Types: [Agent](core.md)

Source: [`packages/claim/claim/src/index.ts`](../../packages/claim/claim/src/index.ts)
<!-- END GENERATED cordis-surface -->
