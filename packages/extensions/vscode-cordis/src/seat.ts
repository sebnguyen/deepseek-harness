/**
 * The seat loop: keep the seat's uplink `hello` on the wire, pump the twin's
 * private downlink into the local event space, and reconnect through its
 * failures.
 *
 * The loop is deliberately engine-reuse-first: its `remote` argument is
 * the mounted gateway client face, the same object the web client's
 * remotest high layers call. Lifecycle (signal abort) is the caller's;
 * backoff here is unbounded-but-throttled, because a twin's seat lives
 * with its host process. Only a cycle that stayed up for `stableAfterMs`
 * resets it: a host that accepts `hello` and then drops the downlink (a
 * rejected event-result RPC, for one) must not drive a 500ms hammer.
 * @module @deepseek-ai/dsh-vscode-cordis/seat
 */

import type { IdeBridgeHelloMeta, IdeBridgeReportRequest, IdeBridgeTwinCall } from '@deepseek-ai/dsh-api-ide/types'

/** The mounted generated-remote slice the loop consumes (testable sans engine). */
export interface VscodeRemoteFace {
  report(request: IdeBridgeReportRequest): Promise<unknown>
  downlink(request: IdeBridgeTwinCall, signal: AbortSignal): AsyncIterable<unknown>
}

export interface SeatEmit {
  (name: string, frame: unknown): void
}

export interface SeatLogger {
  (message: string, error?: unknown): void
}

/** One downlink-to-local event relay, the contract the note pins. */
export const SEAT_EVENT_PREFIX = 'dsh/frame/'

/**
 * A frame's verb is legal only in the `<extId>/<verb>` character space the
 * namespace convention permits; anything outside this pattern is dropped
 * (logged) rather than routed, guarding the Cordis event namespace from
 * authority confusion.
 */
const FRAME_VERB_PATTERN = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._/-]+$/

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Run the seat until `signal` aborts.
 *
 * One outer iteration = one fully established seat: hello reported,
 * downlink pumped till it gives way. Every traitorous error is the same
 * reconnect candidate — recoveries come either from the connection
 * layer disconnecting and the seat re-firing, or from waiting out a
 * host down in backoff.
 */
export async function runSeatLoop(deps: {
  remote: VscodeRemoteFace
  identity: { token: string; hello: IdeBridgeHelloMeta }
  signal: AbortSignal
  emit: SeatEmit
  logger?: SeatLogger
  sleep?: (ms: number) => Promise<void>
  initialBackoffMs?: number
  maxBackoffMs?: number
  /**
   * How long one cycle must stay up before it resets the backoff. Defaults
   * to `maxBackoffMs`: a fresh hello with an immediately lost downlink is not
   * a recovery.
   */
  stableAfterMs?: number
}): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep
  const initialBackoff = deps.initialBackoffMs ?? 500
  const maxBackoff = deps.maxBackoffMs ?? 30_000
  const stableAfterMs = deps.stableAfterMs ?? maxBackoff
  const { signal } = deps
  let backoff = initialBackoff

  while (!signal.aborted) {
    const began = Date.now()
    try {
      await deps.remote.report({
        token: deps.identity.token,
        event: { type: 'hello', ...deps.identity.hello },
      })
      deps.logger?.('twin seat: established')
      for await (const frame of deps.remote.downlink({ token: deps.identity.token }, signal)) {
        publish(deps.emit, frame, deps.logger)
      }
      const healthy = Date.now() - began >= stableAfterMs
      if (healthy) backoff = initialBackoff
      if (!signal.aborted) {
        deps.logger?.(`twin seat: downlink stream ended; re-establishing after ${backoff}ms`)
        await sleep(backoff)
        if (!healthy) backoff = Math.min(backoff * 2, maxBackoff)
      }
    } catch (error) {
      if (signal.aborted) return
      if (Date.now() - began >= stableAfterMs) backoff = initialBackoff
      deps.logger?.(`twin seat: connection attempt failed; retrying in ${backoff}ms`, error)
      await sleep(backoff)
      backoff = Math.min(backoff * 2, maxBackoff)
    }
  }
}

/**
 * Route one decoded frame to its local event. Frames whose verb escapes
 * the namespace alphabet are refused here, not at each consumer.
 */
function publish(emit: SeatEmit, frame: unknown, logger?: SeatLogger): void {
  if (typeof frame !== 'object' || frame === null) { logger?.('twin seat: dropped non-object frame'); return }
  const type = (frame as { type?: unknown }).type
  if (typeof type !== 'string' || !FRAME_VERB_PATTERN.test(type)) {
    logger?.('twin seat: dropped frame with illegible verb', frame)
    return
  }
  logger?.(`twin seat: frame ${type}`)
  emit(`${SEAT_EVENT_PREFIX}${type}`, frame)
}
