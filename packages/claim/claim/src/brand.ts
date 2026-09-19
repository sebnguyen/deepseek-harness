/**
 * Branded claim identity. The type and its brander share one module so a
 * re-export carries both meanings without a duplicate-name declaration.
 * @module @deepseek-ai/dsh-claim/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one verification claim across its durable revisions. */
export type ClaimId = Branded<'ClaimId'>

/**
 * Brand an implementation-minted claim identity.
 * @param id - opaque claim identity.
 * @returns the same string with the compile-time brand.
 */
export function ClaimId(id: string): ClaimId {
  return id as ClaimId
}
