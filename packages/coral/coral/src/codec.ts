/** Framing codecs: message encode/decode over transport frames. */

import type { Codec, CodecId, Decoder, TransportFrame, WireMessage } from './types.ts'

const encoder = new TextEncoder()

export const NDJSON: CodecId = 'ndjson' as CodecId

/** JSON-per-line framing shared by the ACP family of standards. */
export const ndjsonCodec: Codec = {
  id: NDJSON,
  encode(message: WireMessage): TransportFrame[] {
    return [encoder.encode(JSON.stringify(message) + '\n')]
  },
  decoder(): Decoder {
    const text = new TextDecoder()
    let buffer = ''
    return {
      push(frame: TransportFrame): WireMessage[] {
        buffer += text.decode(frame, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        const messages: WireMessage[] = []
        for (const line of lines) {
          if (line.length === 0) continue
          messages.push(JSON.parse(line) as WireMessage)
        }
        return messages
      },
    }
  },
}
