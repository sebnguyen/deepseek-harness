/**
 * Staff-certificate fetch for a route pinned to one private inference host.
 * The public `digitalocean` route does not use this path.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:https'
import type { Server } from 'node:https'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import tls, { type TLSSocket } from 'node:tls'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { type StreamChunk } from '@deepseek-ai/dsh-llm'

const streamSimple = vi.hoisted(() => vi.fn())

vi.mock('@earendil-works/pi-ai/api/openai-completions.lazy', () => ({
  openAICompletionsApi: () => ({ stream: streamSimple, streamSimple }),
}))

import { PiAiAdapter } from '../src/adapter.ts'
import { shippedRoute } from '../src/catalog.ts'
import { clientCertFetch, expandHome, profileClientFetch } from '../src/client-cert-fetch.ts'
import { resolveProfiles } from '../src/config.ts'
import * as LlmPiAi from '../src/index.ts'
import { memoryAuth } from './auth-double.ts'

const previousReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED
const servers: Server[] = []
const dirs: string[] = []

afterEach(async () => {
  streamSimple.mockReset()
  if (previousReject === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousReject
  delete process.env.REGION_KEY
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Certs {
  dir: string
  cert: string
  key: string
  ca: string
  serverCert: string
  serverKey: string
}

/** A one-day CA plus a server certificate for 127.0.0.1 and a client pair. */
function makeCerts(): Certs {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-staff-cert-'))
  dirs.push(dir)
  const caKey = join(dir, 'ca.key')
  const ca = join(dir, 'ca.crt')
  const serverKey = join(dir, 'server.key')
  const serverCsr = join(dir, 'server.csr')
  const serverCert = join(dir, 'server.crt')
  const clientKey = join(dir, 'client.key')
  const clientCsr = join(dir, 'client.csr')
  const cert = join(dir, 'client.crt')
  const ext = join(dir, 'san.cnf')
  writeFileSync(ext, 'subjectAltName=IP:127.0.0.1\n')
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', caKey, '-out', ca, '-days', '1', '-nodes', '-subj', '/CN=test-ca'])
  execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-keyout', serverKey, '-out', serverCsr, '-nodes', '-subj', '/CN=127.0.0.1'])
  execFileSync('openssl', ['x509', '-req', '-in', serverCsr, '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-out', serverCert, '-days', '1', '-extfile', ext])
  execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-keyout', clientKey, '-out', clientCsr, '-nodes', '-subj', '/CN=staff'])
  execFileSync('openssl', ['x509', '-req', '-in', clientCsr, '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-out', cert, '-days', '1'])
  return { dir, cert, key: clientKey, ca, serverCert, serverKey }
}

/** HTTPS listing that accepts only the generated client certificate. */
async function certServer(certs: Certs): Promise<{ url: string; authorized: boolean[] }> {
  const authorized: boolean[] = []
  const server = createServer({
    cert: readFileSync(certs.serverCert),
    key: readFileSync(certs.serverKey),
    ca: readFileSync(certs.ca),
    requestCert: true,
    rejectUnauthorized: true,
  }, (request, response) => {
    authorized.push((request.socket as TLSSocket).authorized)
    const body = JSON.stringify({ data: [{ id: 'region-model', context_window: 1024, max_tokens: 128 }] })
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) })
    response.end(request.url?.includes('/models') ? body : 'ok')
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `https://127.0.0.1:${address.port}`, authorized }
}

describe('regional inference routes', () => {
  it('keeps the public digitalocean endpoint and pins each production region', () => {
    expect(shippedRoute('digitalocean')?.baseURL).toBe('https://inference.do-ai.run/v1')
    expect(shippedRoute('internal_digital_ocean_atl1')?.baseURL)
      .toBe('https://inference-serving-production-atl1.traefik.gen-ai.cloud-infra.dointernal.com/v1')
    expect(shippedRoute('internal_digital_ocean_ric1')?.baseURL)
      .toBe('https://inference-serving-production-ric1.traefik.gen-ai.cloud-infra.dointernal.com/v1')
    expect(shippedRoute('internal_digital_ocean_tor1')?.baseURL)
      .toBe('https://inference-serving-production-tor1.traefik.gen-ai.cloud-infra.dointernal.com/v1')
    expect(shippedRoute('internal_digital_ocean_atl1')?.displayName).toBe('internal_digital_ocean_atl1')
  })

  it('refuses a certificate path without its key', () => {
    expect(() => resolveProfiles({
      internal_digital_ocean_atl1: { clientCert: '~/.ssh/staff.crt' },
    })).toThrow(/must set clientCert and clientKey together/)
    expect(() => resolveProfiles({
      internal_digital_ocean_atl1: { clientCert: '', clientKey: '' },
    })).toThrow(/must be non-empty paths/)
  })
})

describe('client certificate fetch', () => {
  it('expands a home marker and leaves other paths unchanged', () => {
    expect(expandHome('~')).toBe(homedir())
    expect(expandHome('~/staff.crt')).toMatch(/\/staff\.crt$/)
    expect(expandHome('/etc/staff.crt')).toBe('/etc/staff.crt')
    expect(profileClientFetch({})).toBeUndefined()
    expect(profileClientFetch({ clientKey: '/no/such.key' })).toBeUndefined()
    expect(profileClientFetch({ clientCert: '/no/such.crt' })).toBeUndefined()
  })

  it('fails when the certificate files are absent', () => {
    expect(() => clientCertFetch('/no/such/staff.crt', '/no/such/staff.key')).toThrow(/cannot read client certificate/)
  })

  it('presents the certificate, reuses it, and rereads it after the files change', async () => {
    const certs = makeCerts()
    const server = await certServer(certs)
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    const first = clientCertFetch(certs.cert, certs.key)
    const again = clientCertFetch(certs.cert, certs.key)
    expect(again).toBe(first)
    expect((await first(`${server.url}/v1/models`)).status).toBe(200)
    const later = new Date(Date.now() + 5_000)
    utimesSync(certs.cert, later, later)
    utimesSync(certs.key, later, later)
    const reread = clientCertFetch(certs.cert, certs.key)
    expect(reread).not.toBe(first)
    expect((await reread(`${server.url}/health`)).status).toBe(200)
    expect(server.authorized).toEqual([true, true])
  })

  it('omits the CA override when the system store is empty', async () => {
    const certs = makeCerts()
    const server = await certServer(certs)
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    vi.spyOn(tls, 'getCACertificates').mockReturnValue([])
    try {
      const fetchWithCert = clientCertFetch(certs.cert, certs.key)
      expect((await fetchWithCert(`${server.url}/health`)).status).toBe(200)
      expect(server.authorized).toEqual([true])
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('lists models for a cert-pinned route and passes the fetch to pi-ai', async () => {
    const certs = makeCerts()
    const server = await certServer(certs)
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    process.env.REGION_KEY = 'region-key'
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        internal_digital_ocean_atl1: {
          apiKeyEnv: 'REGION_KEY',
          clientCert: certs.cert,
          clientKey: certs.key,
          baseURL: `${server.url}/v1`,
        },
      },
    })
    await expect.poll(
      async () => (await ctx.llm.listModels('internal_digital_ocean_atl1')).map(model => model.id),
      { timeout: 10_000 },
    ).toEqual(['region-model'])
    const discovered = await ctx.llm.discoverModels('llm-pi-ai', {
      provider: 'internal_digital_ocean_atl1',
      baseURL: `${server.url}/v1`,
      api: 'openai-completions',
    })
    expect(discovered.map(model => model.id)).toContain('region-model')
    await ctx.fiber.dispose()

    streamSimple.mockImplementation(() => { throw new Error('options probe') })
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({
        'local-gateway': {
          api: 'openai-completions',
          baseURL: `${server.url}/v1`,
          clientCert: certs.cert,
          clientKey: certs.key,
          models: [{ id: 'local-model', contextWindow: 8192, maxTokens: 1024 }],
        },
      }),
      resolveApiKey: () => Promise.resolve('test-key'),
      auth: memoryAuth(),
    })
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({ provider: 'local-gateway', model: 'local-model', messages: [] })) {
      chunks.push(chunk)
    }
    const options = streamSimple.mock.calls[0]?.[2] as { fetch?: unknown } | undefined
    expect(typeof options?.fetch).toBe('function')
    expect(chunks.at(-1)).toMatchObject({ type: 'finish' })
  })
})
