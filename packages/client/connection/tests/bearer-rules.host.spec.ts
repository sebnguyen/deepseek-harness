/** Scoped bearer rules: a Host feature's process tokens against the browser-cookie fence. */

import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import type { WebRoute, WebUpgradeRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { API_PATH, apply, inject, type ConnectionConfig, type HostConnectionHandle } from '../src/index.ts'
import { provideBrowserCredentials } from './browser-credentials.ts'

function fakeHttpServer(routes: WebRoute[], upgrades: WebUpgradeRoute[]): Pick<WebServer, 'register' | 'registerUpgrade' | 'tapIndex' | 'port'> {
  return {
    register(route) { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } },
    registerUpgrade(route) { upgrades.push(route); return () => { upgrades.splice(upgrades.indexOf(route), 1) } },
    tapIndex: () => () => {},
    port: 0,
  }
}

function fakeRequest(headers: Record<string, string>, url: string): IncomingMessage {
  const request = Readable.from([]) as unknown as IncomingMessage
  Object.assign(request, { url, method: 'GET', headers })
  return request
}

async function mounted(config?: ConnectionConfig): Promise<{
  connection: HostConnectionHandle
  dispose: () => Promise<void>
}> {
  const ctx = new Context()
  provideBrowserCredentials(ctx)
  ctx.provide('webServer', fakeHttpServer([], []) as WebServer)
  const fiber = ctx.plugin({ inject: [...inject], apply }, config)
  await fiber.await()
  return { connection: ctx.get('connection') as HostConnectionHandle, dispose: () => fiber.dispose() }
}

const WEB_ENDPOINT = 'workspaceController/follow'
const IDE_ENDPOINTS = ['ideBridge/downlink', 'ideBridge/report'] as const

describe('connection bearer rules', () => {
  it('admits a matching bearer token on a named endpoint, cookie-free', async () => {
    const { connection, dispose } = await mounted()
    const revoke = connection.registerBearerRule({ endpoints: [...IDE_ENDPOINTS], validate: token => token === 'twin-1' })
    expect(connection.requestRejection(fakeRequest({
      host: '127.0.0.1:3080',
      authorization: 'Bearer twin-1',
    }, `${API_PATH}/ideBridge/downlink`))).toBeUndefined()
    expect(connection.requestRejection(fakeRequest({
      host: '127.0.0.1:3080',
      authorization: 'Bearer twin-1',
    }, `${API_PATH}/ideBridge/report`))).toBeUndefined()
    await dispose()
    void revoke
  })

  it('refuses the same token on an endpoint outside the rule, and a wrong token on a named endpoint', async () => {
    const { connection, dispose } = await mounted()
    connection.registerBearerRule({ endpoints: [...IDE_ENDPOINTS], validate: token => token === 'twin-1' })
    expect(connection.requestRejection(fakeRequest({
      host: '127.0.0.1:3080',
      authorization: 'Bearer twin-1',
    }, `${API_PATH}/${WEB_ENDPOINT}`))).toBe(401)
    expect(connection.requestRejection(fakeRequest({
      host: '127.0.0.1:3080',
      authorization: 'Bearer twin-2',
    }, `${API_PATH}/ideBridge/downlink`))).toBe(401)
    expect(connection.requestRejection(fakeRequest({
      host: '127.0.0.1:3080',
      authorization: 'Bearer',
    }, `${API_PATH}/ideBridge/downlink`))).toBe(401)
    await dispose()
  })

  it('accepts the tkn query parameter on a shared /api WebSocket upgrade regardless of endpoints', async () => {
    const { connection, dispose } = await mounted()
    connection.registerBearerRule({ endpoints: [...IDE_ENDPOINTS], validate: token => token === 'twin-1' })
    expect(connection.requestRejection(fakeRequest({
      host: '127.0.0.1:3080',
      upgrade: 'websocket',
    }, `${API_PATH}/remote.mux?tkn=twin-1`))).toBeUndefined()
    expect(connection.requestRejection(fakeRequest({
      host: '127.0.0.1:3080',
      upgrade: 'websocket',
    }, `${API_PATH}/remote.mux?tkn=twin-2`))).toBe(401)
    expect(connection.requestRejection(fakeRequest({
      host: '127.0.0.1:3080',
      upgrade: 'websocket',
    }, `${API_PATH}/remote.mux`))).toBe(401)
    await dispose()
  })

  it('keeps the Host/Origin fence ahead of bearer admission', async () => {
    const { connection, dispose } = await mounted()
    connection.registerBearerRule({ endpoints: [...IDE_ENDPOINTS], validate: () => true })
    expect(connection.requestRejection(fakeRequest({
      host: 'evil.example',
      authorization: 'Bearer twin-1',
    }, `${API_PATH}/ideBridge/downlink`))).toBe(403)
    await dispose()
  })

  it('withdraws the rule on dispose', async () => {
    const { connection, dispose } = await mounted()
    const revoke = connection.registerBearerRule({ endpoints: [...IDE_ENDPOINTS], validate: () => true })
    const req = () => fakeRequest({ host: '127.0.0.1:3080', authorization: 'Bearer any' }, `${API_PATH}/ideBridge/report`)
    expect(connection.requestRejection(req())).toBeUndefined()
    revoke()
    expect(connection.requestRejection(req())).toBe(401)
    await dispose()
  })

  it('needs the request URL to name the endpoint: a header-only bearer shape falls to 401', async () => {
    const { connection, dispose } = await mounted()
    connection.registerBearerRule({ endpoints: [...IDE_ENDPOINTS], validate: () => true })
    expect(connection.requestRejection({ headers: { host: '127.0.0.1:3080', authorization: 'Bearer any' } })).toBe(401)
    await dispose()
  })
})
