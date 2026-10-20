/**
 * TLS client certificate for one pi-ai route. Traefik in front of a private
 * inference host rejects the handshake unless the request presents a staff
 * certificate; the model access key is still a separate HTTP header.
 *
 * @module dsh-llm-pi-ai/client-cert-fetch
 */

import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import tls from 'node:tls'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { Agent, fetch as undiciFetch } from 'undici'

/** One cached dispatcher, invalidated when either PEM file's mtime changes. */
interface CachedCertFetch {
  certMtimeMs: number
  keyMtimeMs: number
  fetch: typeof fetch
  close: () => void
}

const cache = new Map<string, CachedCertFetch>()

/**
 * Expand a leading `~` to the process user's home directory.
 * @param path - a certificate or key path from configuration.
 * @returns the path with a leading home marker expanded.
 */
export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Fetch implementation that presents one PEM certificate pair.
 * @param certPath - PEM certificate file; `~` is the home directory.
 * @param keyPath - PEM private-key file; `~` is the home directory.
 * @returns a fetch that presents the pair during TLS and trusts the host system CA store.
 *   Undici's public bundle omits a private issuer on the machine, so the handshake fails before the client certificate is considered.
 * @throws LlmError `INVALID_CONFIG` when either file cannot be read.
 */
export function clientCertFetch(certPath: string, keyPath: string): typeof fetch {
  const certFile = expandHome(certPath)
  const keyFile = expandHome(keyPath)
  const id = `${certFile}\0${keyFile}`
  let certStat: { mtimeMs: number }
  let keyStat: { mtimeMs: number }
  let cert: Buffer
  let key: Buffer
  try {
    certStat = statSync(certFile)
    keyStat = statSync(keyFile)
    const hit = cache.get(id)
    if (hit !== undefined && hit.certMtimeMs === certStat.mtimeMs && hit.keyMtimeMs === keyStat.mtimeMs) {
      return hit.fetch
    }
    cert = readFileSync(certFile)
    key = readFileSync(keyFile)
    hit?.close()
  } catch (error) {
    throw new LlmError(
      `llm-pi-ai: cannot read client certificate ${certFile} or key ${keyFile}`,
      'INVALID_CONFIG',
      { cause: error },
    )
  }
  const ca = tls.getCACertificates('system')
  const agent = new Agent({
    connect: {
      cert,
      key,
      ...ca.length > 0 ? { ca } : {},
    },
  })
  const bound = ((input: RequestInfo | URL, init?: RequestInit) => undiciFetch(input as never, {
    ...init,
    dispatcher: agent,
  } as never)) as typeof fetch
  cache.set(id, {
    certMtimeMs: certStat.mtimeMs,
    keyMtimeMs: keyStat.mtimeMs,
    fetch: bound,
    close: () => { void agent.close() },
  })
  return bound
}

/**
 * The route's client-certificate fetch, when the profile names a pair.
 * @param profile - resolved route profile.
 * @returns the fetch, or `undefined` when the route uses default TLS.
 */
export function profileClientFetch(
  profile: { clientCert?: string; clientKey?: string },
): typeof fetch | undefined {
  if (profile.clientCert === undefined || profile.clientKey === undefined) return undefined
  return clientCertFetch(profile.clientCert, profile.clientKey)
}
