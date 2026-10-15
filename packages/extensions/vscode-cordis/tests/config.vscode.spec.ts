/** bridge.json identity parsing and discovery, against real temp files. */

import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BridgeConfigError, bridgeIdentityPath, parseBridgeIdentity, readBridgeIdentity } from '../src/config.ts'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function stageDir(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-bridge-config-')))
  tempDirs.push(dir)
  return dir
}

describe('bridge identity', () => {
  it('accepts a valid spawn identity, including the idle-origin form', () => {
    expect(parseBridgeIdentity({
      dshOrigin: 'http://127.0.0.1:4455', token: 'tok-9', workspaceKey: '/repo',
    })).toEqual({ dshOrigin: 'http://127.0.0.1:4455', token: 'tok-9', workspaceKey: '/repo' })
    expect(parseBridgeIdentity({ dshOrigin: '', token: 'tok-9', workspaceKey: '/repo' }))
      .toEqual({ dshOrigin: '', token: 'tok-9', workspaceKey: '/repo' })
  })

  it('refuses non-object, tokenless, and keyless shapes by their names', () => {
    for (const [payload, reason] of [
      [null, 'shape-invalid'],
      ['a string', 'shape-invalid'],
      [{ dshOrigin: 'x', workspaceKey: '/repo' }, 'token-missing'],
      [{ dshOrigin: 'x', token: '', workspaceKey: '/repo' }, 'token-missing'],
      [{ dshOrigin: 'x', token: 'tok' }, 'workspaceKey-missing'],
      [{ dshOrigin: 'x', token: 'tok', workspaceKey: '' }, 'workspaceKey-missing'],
    ] as const) {
      expect(() => parseBridgeIdentity(payload)).toThrowError(
        expect.objectContaining({ name: 'BridgeConfigError' }) as BridgeConfigError,
      )
      try { parseBridgeIdentity(payload) } catch (error) {
        expect((error as BridgeConfigError).reason).toBe(reason)
      }
    }
  })

  it('reads from disk when the file parses and narrows missing/malformed files', async () => {
    const dir = stageDir()
    await expect(readBridgeIdentity(join(dir, 'missing.json')))
      .rejects.toMatchObject({ name: 'BridgeConfigError', reason: 'identity-missing' })
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{no-json', 'utf8')
    await expect(readBridgeIdentity(bad)).rejects.toMatchObject({ name: 'BridgeConfigError', reason: 'json-invalid' })
    const good = join(dir, 'bridge.json')
    writeFileSync(good, JSON.stringify({ dshOrigin: 'http://127.0.0.1:1', token: 't', workspaceKey: '/k' }), 'utf8')
    await expect(readBridgeIdentity(good)).resolves.toEqual({
      dshOrigin: 'http://127.0.0.1:1', token: 't', workspaceKey: '/k',
    })
  })

  it('discovers bridge.json at the .dsh root from a staged extension dir', () => {
    const dsh = stageDir()
    mkdirSync(join(dsh, 'exts', 'dsh-bridge'), { recursive: true })
    const found = bridgeIdentityPath(join(dsh, 'exts', 'dsh-bridge'))
    expect(found).toBe(join(dsh, 'bridge.json'))
  })
})
