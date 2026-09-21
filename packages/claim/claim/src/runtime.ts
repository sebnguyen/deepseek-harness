/** Runtime constructors and stable error codes for the claim domain. */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable error codes for rejected claim reads and mutations. */
export type ClaimErrorCode =
  | 'CLAIM_AGENT_NOT_LIVE'
  | 'CLAIM_NONE_OPEN'
  | 'CLAIM_UNKNOWN'
  | 'CLAIM_NO_OPEN_TURN'
  | 'CLAIM_INVALID_TITLE'
  | 'CLAIM_INVALID_DESCRIPTION'
  | 'CLAIM_VERIFIER_NOT_RUN'
  | 'CLAIM_INVALID_SCRIPT'
  | 'CLAIM_INVALID_EVENT'

/** Error returned by the claim domain boundary. */
export class ClaimError extends HarnessError {
  /**
   * @param message - human-readable rejection reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: ClaimErrorCode) {
    super(message, code)
  }
}
