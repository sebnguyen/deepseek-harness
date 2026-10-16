/**
 * The twin's identity extension staging: the manifest + theme files land in
 * the extensions dir bit-for-bit on every spawn, and the pieces the
 * workbench consumes stay schema-shaped.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DO_THEME_COLORS,
  stageTwinProposedApis,
  stageVscodeBridgeExtension,
  stageVscodeBridgeIdentity,
  stageTwinTheme,
  TWIN_BRIDGE_EXTENSION_DIR_NAME,
  TWIN_BRIDGE_EXTENSION_ID,
  TWIN_BRIDGE_IDENTITY_BASENAME,
  TWIN_CONFIGURATION_DEFAULTS,
  TWIN_PROPOSED_APIS,
  VSCODE_THEME_DIR_NAME,
  VSCODE_THEME_EXTENSION_ID,
} from '../src/twin-theme.ts'

const mounted: string[] = []

/** One throwaway extensions-dir per case, swept on teardown. */
async function extsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ide-twin-theme-'))
  mounted.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(mounted.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('stageVscodeBridgeExtension', () => {
  it('copies the compiled bundle verbatim alongside its vscode manifest', async () => {
    const dir = await extsDir()
    const bundle = join(dir, 'bundle.cjs')
    await writeFile(bundle, "'use strict';module.exports={activate:function(){},deactivate:function(){}}", 'utf8')
    const staged = await stageVscodeBridgeExtension(dir, bundle)
    expect(staged).toBe(join(dir, TWIN_BRIDGE_EXTENSION_DIR_NAME))
    const manifest = JSON.parse(await readFile(join(staged!, 'package.json'), 'utf8')) as {
      publisher: string
      name: string
      main: string
      activationEvents: string[]
    }
    expect(`${manifest.publisher}.${manifest.name}`).toBe('dsh.do-harness-bridge')
    expect(manifest.main).toBe('./extension.cjs')
    expect(manifest.activationEvents).toContain('onStartupFinished')
    const bytes = await readFile(join(staged!, 'extension.cjs'), 'utf8')
    expect(bytes).toContain('module.exports')
    // The planes' user-invokable commands land here: the only manifest the
    // workbench reads, so discoverability is staged, not contributed by a plane.
    const commands = (manifest as { contributes?: { commands?: Array<{ command: string }> } })
      .contributes?.commands?.map(command => command.command) ?? []
    expect(commands).toContain('do-harness.addLineNote')
  })

  it('reports null and stages nothing when the workspace build has not emitted the bundle yet', async () => {
    const dir = await extsDir()
    const staged = await stageVscodeBridgeExtension(dir, join(dir, 'not-built.cjs'))
    expect(staged).toBeNull()
  })
})

describe('stageTwinProposedApis', () => {
  it('allow-lists the bridge id in the deployment product.json, preserving siblings', async () => {
    const dir = await extsDir()
    const product = join(dir, 'product.json')
    await writeFile(product, JSON.stringify({
      nameShort: 'Code - OSS',
      extensionEnabledApiProposals: { 'ms-vscode.built-in': ['chat'] },
    }), 'utf8')
    await stageTwinProposedApis(product)
    const staged = JSON.parse(await readFile(product, 'utf8')) as Record<string, unknown>
    const map = staged.extensionEnabledApiProposals as Record<string, string[]>
    expect(map['ms-vscode.built-in']).toEqual(['chat'])
    expect(map[TWIN_BRIDGE_EXTENSION_ID]).toEqual([...TWIN_PROPOSED_APIS])
    expect(staged.nameShort).toBe('Code - OSS')
  })

  it('is a no-op on repeat calls and on a dist missing the file', async () => {
    const dir = await extsDir()
    const product = join(dir, 'product.json')
    await writeFile(product, JSON.stringify({ nameShort: 'Code - OSS' }), 'utf8')
    await stageTwinProposedApis(product)
    const once = await readFile(product, 'utf8')
    await stageTwinProposedApis(product)
    const twice = await readFile(product, 'utf8')
    expect(twice).toBe(once)
    await stageTwinProposedApis(join(dir, 'absent.json'))
  })
})

describe('stageVscodeBridgeIdentity', () => {
  it('writes the per-spawn facts beside the twin state dirs, schema-shaped', async () => {
    const dir = await extsDir()
    const identity = { dshOrigin: 'http://127.0.0.1:4455', token: 'tok-abc', workspaceKey: '/repo' }
    await stageVscodeBridgeIdentity(dir, identity)
    const staged = JSON.parse(await readFile(join(dir, TWIN_BRIDGE_IDENTITY_BASENAME), 'utf8')) as unknown
    expect(staged).toEqual(identity)
  })

  it('rewrites in place on respawn so a stale origin or token never survives', async () => {
    const dir = await extsDir()
    await stageVscodeBridgeIdentity(dir, { dshOrigin: 'http://127.0.0.1:1', token: 'a', workspaceKey: '/one' })
    const next = { dshOrigin: 'http://127.0.0.1:4455', token: 'tok-b', workspaceKey: '/two' }
    await stageVscodeBridgeIdentity(dir, next)
    const staged = JSON.parse(await readFile(join(dir, TWIN_BRIDGE_IDENTITY_BASENAME), 'utf8')) as unknown
    expect(staged).toEqual(next)
  })
})

describe('stageTwinTheme', () => {
  it('lays out the extension the installed-extension scan accepts', async () => {
    const dir = await extsDir()
    const staged = await stageTwinTheme(dir)
    expect(staged).toBe(join(dir, VSCODE_THEME_DIR_NAME))
    const manifest = JSON.parse(await readFile(join(staged, 'package.json'), 'utf8')) as {
      name: string
      publisher: string
      engines: { vscode: string }
      main?: string
      activationEvents?: string[]
      contributes: {
        configurationDefaults: Record<string, unknown>
        themes: Array<{ label: string; uiTheme: string; path: string }>
      }
    }
    expect(`${manifest.publisher}.${manifest.name}`).toBe(VSCODE_THEME_EXTENSION_ID)
    expect(TWIN_CONFIGURATION_DEFAULTS['workbench.colorTheme']).toBe('DO Harness Dark')
    expect(manifest.contributes.configurationDefaults).toEqual(TWIN_CONFIGURATION_DEFAULTS)
    expect(manifest.contributes.themes).toHaveLength(1)
    expect(manifest.contributes.themes[0]?.label).toBe('DO Harness Dark')
    const theme = JSON.parse(await readFile(join(staged, 'themes', 'do-harness-dark-color-theme.json'), 'utf8')) as {
      colors: Record<string, string>
      tokenColors: unknown[]
    }
    expect(theme.colors).toEqual(DO_THEME_COLORS)
    expect(theme.tokenColors.length).toBeGreaterThan(5)
  })

  it('is idempotent and repairs drift: staged content is harness-owned', async () => {
    const dir = await extsDir()
    const staged = await stageTwinTheme(dir)
    await writeFile(join(staged, 'package.json'), '{"corrupt":true}', 'utf8')
    const again = await stageTwinTheme(dir)
    expect(again).toBe(staged)
    const manifest = JSON.parse(await readFile(join(again, 'package.json'), 'utf8')) as { corrupt?: boolean }
    expect(manifest.corrupt).toBeUndefined()
  })

  it('hushed-chrome defaults carry the chrome the embedding needs silenced', async () => {
    expect(TWIN_CONFIGURATION_DEFAULTS['workbench.startupEditor']).toBe('none')
    expect(TWIN_CONFIGURATION_DEFAULTS['security.workspace.trust.enabled']).toBe(false)
    expect(TWIN_CONFIGURATION_DEFAULTS['editor.minimap.enabled']).toBe(false)
    expect(String(TWIN_CONFIGURATION_DEFAULTS['editor.fontFamily'])).toContain('SF Mono')
    expect(String(TWIN_CONFIGURATION_DEFAULTS['window.title'])).not.toContain('${appName}')
  })

  it('the twin is editor-only: chat surfaces and the aux bar are gone, tree on the right', async () => {
    expect(TWIN_CONFIGURATION_DEFAULTS['chat.disableAIFeatures']).toBe(true)
    expect(TWIN_CONFIGURATION_DEFAULTS['chat.agentsControl.enabled']).toBe('hidden')
    expect(TWIN_CONFIGURATION_DEFAULTS['workbench.secondarySideBar.defaultVisibility']).toBe('hidden')
    expect(DO_THEME_COLORS['focusBorder']).toBe('#7bb4bc80')
  })

  it('fires the deterministic side-bar-right command once per profile', async () => {
    const dir = await extsDir()
    const staged = await stageTwinTheme(dir)
    const manifest = JSON.parse(await readFile(join(staged, 'package.json'), 'utf8')) as {
      main?: string
      activationEvents?: string[]
    }
    expect(manifest.main).toBe('./extension.cjs')
    expect(manifest.activationEvents).toContain('onStartupFinished')
    const boot = await readFile(join(staged, 'extension.cjs'), 'utf8')
    expect(boot).toContain('workbench.action.moveSideBarLeft')
    expect(boot).toContain('dsh.do-harness.sideBarLeft')
    expect(boot).toContain('globalState')
  })

  it('workbench colors stay hex so the theme file loads clean', async () => {
    for (const [slot, value] of Object.entries(DO_THEME_COLORS)) {
      expect(value, slot).toMatch(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/)
    }
    expect(Object.keys(DO_THEME_COLORS).length).toBeGreaterThan(40)
  })
})
