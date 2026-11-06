/** Closed non-CDP Inspector query and result model. */

import type { CordisRuntimeTree } from '../../../cordis/model.ts'
import type { InspectorJsonValue } from '../../../json.ts'

/** Read the latest committed Cordis runtime tree. */
export interface CordisTreeGetQuery {
  readonly op: 'cordis-tree/get'
}

/** One selected service's current detached preview. */
export type CordisServicePreview =
  | { readonly kind: 'json'; readonly value: InspectorJsonValue }
  | { readonly kind: 'summary'; readonly text: string }

/** Read one exact service without entering its value into periodic snapshots. */
export type CordisServiceGetQuery = {
  readonly op: 'cordis-service/get'
  readonly targetSourceId: string
  readonly kind: 'injected'
  readonly fiberUid: number
  readonly name: string
  readonly providerUid: number | null
} | {
  readonly op: 'cordis-service/get'
  readonly targetSourceId: string
  readonly kind: 'provided'
  readonly fiberUid: number
  readonly name: string
  readonly ordinal: number
  readonly occurrences: number
}

/** Query operations accepted by the Inspector Worker. */
export type InspectorQuery = CordisTreeGetQuery | CordisServiceGetQuery

/** Result of reading the latest committed Cordis runtime tree. */
export interface CordisTreeGetResult {
  readonly op: 'cordis-tree/get'
  readonly tree: CordisRuntimeTree
}

/** Result of reading one selected service value on demand. */
export interface CordisServiceGetResult {
  readonly op: 'cordis-service/get'
  readonly preview: CordisServicePreview
}

/** Results correlated to {@link InspectorQuery} by `op`. */
export type InspectorQueryResult = CordisTreeGetResult | CordisServiceGetResult

/** Result member corresponding to one query member. */
export type InspectorQueryResultFor<Query extends InspectorQuery> = Extract<InspectorQueryResult, { op: Query['op'] }>

/** Stable Worker-side query failure. */
export interface InspectorQueryError {
  readonly code: 'invalid-request' | 'stale-source' | 'result-too-large' | 'internal-error'
  readonly message: string
}

/** Host/Client interface implemented by the shared correlated-query owner. */
export interface InspectorQueryRequester {
  /**
   * Execute one query against the current connected source generation.
   * @param query - Closed typed query command.
   * @returns The result with the same operation discriminant.
   * @throws When transport or Worker processing cannot settle the request successfully.
   */
  request<Query extends InspectorQuery>(query: Query): Promise<InspectorQueryResultFor<Query>>
}
