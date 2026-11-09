/** Errors shared by the host and tool planes. */

export type PeerToolCode =
  | 'UNKNOWN_ENDPOINT'
  | 'UNSUPPORTED_CAPABILITY'
  | 'NO_CLIENT'
  | 'SESSION_CLOSED'

export class PeerToolError extends Error {
  constructor(readonly code: PeerToolCode, message: string) {
    super(message)
    this.name = 'PeerToolError'
  }
}
