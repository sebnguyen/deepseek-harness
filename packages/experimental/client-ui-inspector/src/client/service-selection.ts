/** Identity of one selected service-to-provider relationship in a realm. */

import type {
  CordisRuntimeContext,
  CordisRuntimeFiber,
  CordisRuntimeSourceId,
  CordisServiceGetQuery,
} from '@deepseek-ai/dsh-experimental-inspector/client'

/** Exact coordinates used to focus a provider and, later, inspect its service. */
export type CordisServiceSelection = {
  readonly kind: 'injected'
  readonly sourceId: CordisRuntimeSourceId
  readonly name: string
  readonly consumerUid: number
  readonly providerUid: number
} | {
  readonly kind: 'provided'
  readonly sourceId: CordisRuntimeSourceId
  readonly name: string
  readonly providerUid: number
  /** Zero-based occurrence within a provider's identically named isolated services. */
  readonly ordinal: number
  /** Count of identically named services at selection time, used for staleness checks. */
  readonly occurrences: number
}

/** Convert a provider selection into the closed Worker query, retaining isolation ordinals. */
export function cordisServiceQuery(selection: CordisServiceSelection): CordisServiceGetQuery {
  if (selection.kind === 'injected') {
    return {
      op: 'cordis-service/get',
      targetSourceId: selection.sourceId,
      kind: 'injected',
      fiberUid: selection.consumerUid,
      name: selection.name,
      providerUid: selection.providerUid,
    }
  }
  return {
    op: 'cordis-service/get',
    targetSourceId: selection.sourceId,
    kind: 'provided',
    fiberUid: selection.providerUid,
    name: selection.name,
    ordinal: selection.ordinal,
    occurrences: selection.occurrences,
  }
}

/** Find one live Fiber inside the current retained tree, independent of display filters. */
export function runtimeFiberByUid(
  root: CordisRuntimeContext | undefined,
  uid: number,
): CordisRuntimeFiber | undefined {
  if (root === undefined) return undefined
  for (const node of root.children) {
    if (node.kind === 'fiber') {
      if (node.uid === uid) return node
      const match = runtimeFiberByUid(node.children[0], uid)
      if (match !== undefined) return match
    } else {
      const match = runtimeFiberByUid(node, uid)
      if (match !== undefined) return match
    }
  }
  return undefined
}
