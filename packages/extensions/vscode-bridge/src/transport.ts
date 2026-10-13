/**
 * The twin's carrier adaptations around the reusable connection machinery.
 *
 * Two adaptations let the vanilla client stack talk from the extension
 * host's Node runtime: a fetch wrapper that reframes unary HTTP to the
 * twin's bearer credential, and the gateway client mux-URL decorator that
 * carries the same credential on the WebSocket upgrade — the handshake
 * that cannot go through headers.
 * @module @deepseek-ai/dsh-vscode-bridge/transport
 */

import type { RpcFetch } from '@deepseek-ai/dsh-client-connection/client'
import { setRemoteStreamUrlDecorator } from '@deepseek-ai/dsh-api-gateway/client'

/** The two spawn facts the carriers consume; kept inline so this module stays client-face-clean. */
interface TwinCarrierIdentity {
  readonly dshOrigin: string
  readonly token: string
}

/**
 * A fetch that posts `/api` calls at the host's loopback origin with the
 * twin's spawn-token bearer credential.
 *
 * The wrapped absolute URLs arrive on `dsh.internal` when the seat runs in
 * a runtime without `location` (Node), so this wrapper substitutes the
 * origin on EVERY http(s) request, including ones that legitimately
 * start non-internal; the twin seat never touches third-party HTTP, so a
 * pointer of mass substitution is the right shape and keeps the credential
 * one hop away from the endpoint family.
 * @param identity - the spawn facts from bridge.json.
 * @param doFetch - transport override (tests inject a recorder).
 * @returns the fetch conformance overload used by `createWebConnectionRpc`.
 */
export function twinFetch(
  identity: TwinCarrierIdentity,
  doFetch?: RpcFetch,
): RpcFetch {
  const origin = identity.dshOrigin
  const base = doFetch ?? ((input, init) => globalThis.fetch(input, init))
  return async (input, init) => {
    if (origin === '') return base(input, init)
    const target = new URL(input.href)
    const forwarded = new URL(origin)
    target.protocol = forwarded.protocol
    target.host = forwarded.host
    const request = {
      ...init,
      headers: mergedHeaders(
        init?.headers as HeadersInit | undefined,
        { authorization: `Bearer ${identity.token}` },
      ),
    }
    return base(target, request)
  }
}

/**
  * The mux-URL decorator: retargets to the twin's host origin and attaches
  * the `tkn` query credential the WHATWG WebSocket handshake cannot carry
  * in headers.
  * @param identity - the spawn facts.
  * @returns the decorator consumed by `setRemoteStreamUrlDecorator`.
  */
export function twinStreamUrlDecorator(
  identity: TwinCarrierIdentity,
): (url: URL) => void {
  return (url) => {
    if (identity.dshOrigin === '') return
    const origin = new URL(identity.dshOrigin)
    url.protocol = origin.protocol
    url.host = origin.host
    url.searchParams.set('tkn', identity.token)
  }
}

/**
 * Install the twinned mux decorator before the first Remote client boots.
 * Idempotent on repeat calls with the same underlying identity.
 * @param identity - spawn facts; empty dshOrigin removes the decorator.
 * @returns restores the no-decorator state.
 */
export function armTwinTransport(identity: TwinCarrierIdentity): () => void {
  setRemoteStreamUrlDecorator(identity.dshOrigin === '' ? undefined : twinStreamUrlDecorator(identity))
  // The pending supporession discipline says the seat restores nothing at
  // disposal except the global decorator itself.
  return () => setRemoteStreamUrlDecorator(undefined)
}

function mergedHeaders(base: HeadersInit | undefined, extra: Record<string, string>): Headers {
  const headers = new Headers(base)
  for (const [name, value] of Object.entries(extra)) {
    // Never override an upstream credential the stack has already named.
    if (!headers.has(name)) headers.set(name, value)
  }
  return headers
}
