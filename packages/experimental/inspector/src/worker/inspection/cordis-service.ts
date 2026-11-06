/** One-shot service-value evaluation against the latest realm snapshot. */

import type { CordisServiceGetQuery, CordisServicePreview } from '../../shared/bridge/messages/query/commands.ts'
import { cordisServiceExpression, parseCordisServicePreview } from '../../shared/cordis/service-value.ts'
import type { CordisTreeNode, CordisFiberTreeNode } from '../../shared/cordis/snapshot.ts'
import type { CordisTreeStore } from './cordis-store.ts'
import type { InspectorRealmRegistry } from './realm-store.ts'

/** Evaluates selected services in their actual realms without a DevTools connection. */
export class CordisServiceEvaluator {
  constructor(
    private readonly trees: CordisTreeStore,
    private readonly realms: InspectorRealmRegistry,
  ) {}

  /** Resolve one object-backed Fiber, evaluate its selected service, and release the realm session. */
  async getService(query: CordisServiceGetQuery): Promise<CordisServicePreview> {
    const retained = this.trees.snapshots().find(item => item.source.sourceId === query.targetSourceId)
    if (retained === undefined || retained.connection.state !== 'connected') {
      throw new Error('Inspector query target realm is stale')
    }
    const realm = this.realms.bySource(retained.source)
    const fiber = findFiber(retained.snapshot.root, query.fiberUid)
    if (realm === undefined || fiber === undefined) throw new Error('Inspector query target Fiber is stale')
    const expression = cordisServiceExpression({
      registryId: retained.snapshot.objectRegistryId,
      handle: fiber.objectHandle,
    }, query)
    const session = realm.openSession()
    try {
      if (session.runtime.state !== 'supported') throw new Error(session.runtime.reason)
      const completion = await session.runtime.backend.evaluate({
        expression,
        returnByValue: true,
        awaitPromise: false,
      })
      if (completion.exceptionDetails !== undefined) throw new Error('Inspector service evaluation failed')
      return parseCordisServicePreview(completion.result.descriptor.value)
    } finally {
      session.close()
    }
  }
}

function findFiber(root: CordisTreeNode, uid: number): CordisFiberTreeNode | undefined {
  if (root.kind === 'fiber' && root.uid === uid) return root
  for (const context of root.kind === 'fiber' ? root.children : [root]) {
    for (const node of context.children) {
      const match = findFiber(node, uid)
      if (match !== undefined) return match
    }
  }
  return undefined
}
