/**
 * Client half-entry: the pure claim vocabulary without host-side imports, so a
 * client aggregate never pulls the service or the Cordis event map in.
 * @module @deepseek-ai/dsh-claim/client
 */

export type {
  Claim,
  ClaimBlockCode,
  ClaimId,
  ClaimProjectionState,
  ClaimSettlement,
  DeclareClaimRequest,
  Verifier,
  VerifierOutcome,
  VerifierResult,
} from './types.ts'
