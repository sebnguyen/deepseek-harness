# 声明式验证 claims

[English](claim.md) | 中文

Claim 接缝——建议性的回合验证策略：agent 在每个工作回合开始时，对回合完成时必须成立的事项作出不可变声明，每条声明绑定一个 shell 验证器。模型通过 `run_claim` 自行运行这些验证器，回合边界则运行仍未关闭的部分。设计权威：[declared verification claims Agent Note](../../.agents/notes/implemented/architecture/2026-09-19-declared-verification-claims.md)。

来源：[`packages/claim/claim/src/index.ts`](../../packages/claim/claim/src/index.ts)

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.zh.md)

Source: [`packages/claim/claim/src/index.ts`](../../packages/claim/claim/src/index.ts)
<!-- END GENERATED cordis-surface -->
