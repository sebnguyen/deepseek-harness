/** ACP constants and the Connection-to-ndjson adapter shared by both ACP planes. */

import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk'
import type { JsonValue, StandardId, Connection } from './types.ts'

export const ACP: StandardId = 'acp' as StandardId

export type AcpCapability = JsonValue

/** Adapt a Coral Connection to the SDK's newline-delimited stream. */
export function connectionStream(connection: Connection): Stream {
  const iterator = connection.read[Symbol.asyncIterator]()
  const readable = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await iterator.next()
      if (result.done === true) {
        controller.close()
        return
      }
      controller.enqueue(result.value)
    },
    async cancel() {
      await iterator.return?.(undefined)
    },
  })
  const writable = new WritableStream<Uint8Array>({
    write: frame => connection.send(frame),
  })
  return ndJsonStream(writable, readable)
}
