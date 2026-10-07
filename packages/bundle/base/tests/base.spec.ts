/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'

describe('dsh-base bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    // The base layer is one insert list over the empty profile root.
    const rows = (parsed as { insert?: { id?: string; name?: string; config?: Record<string, unknown>; disabled?: boolean }[] }[]).flatMap(
      patch => patch.insert ?? [],
    )
    expect(rows.length).toBeGreaterThan(50)
    expect(rows.some(row => row.id === 'agent-loop')).toBe(true)
    expect(rows.find(row => row.id === 'session-telemetry-otel')?.disabled).toBeUndefined()
    expect(rows.find(row => row.id === 'session-telemetry-otel')?.config?.['mode']).toEqual({
      __jsExpr: "process.env.DSH_TELEMETRY_MODE || 'FEEDBACK_ONLY'",
    })
    expect(rows.find(row => row.id === 'hmr')).toMatchObject({
      disabled: true,
      config: { root: ['.'] },
    })
    expect(rows.filter(row => row.id === 'subagent-codex')).toHaveLength(0)
    expect(rows.filter(row => row.id === 'subagent-claude-code')).toHaveLength(0)
    expect(rows.find(row => row.id === 'web')?.config).toMatchObject({ fetchProvider: 'http' })
    expect(rows.find(row => row.id === 'web-fetch-http')).toBeDefined()
    expect(rows.find(row => row.id === 'tool-web')?.config).toMatchObject({ fetch: true })
    expect(rows.find(row => row.id === 'claim')).toMatchObject({ name: '@deepseek-ai/dsh-claim', disabled: true })
    expect(rows.find(row => row.id === 'claim-settlement')).toMatchObject({ name: '@deepseek-ai/dsh-claim-settlement', disabled: true })
    expect(rows.find(row => row.id === 'tool-claim')).toMatchObject({ name: '@deepseek-ai/dsh-tool-claim', disabled: true })
    expect(rows.find(row => row.id === 'knowledge-notes')?.name).toBe('@deepseek-ai/dsh-knowledge-notes')
    expect(rows.find(row => row.id === 'shell-search')?.name).toBe('@deepseek-ai/dsh-shell-search')
    // The LSP rows: the seam and its provider are services, the two tools are
    // the agent plane a preset re-mounts. The provider resolves its commands at
    // load, so the shipped map names only the default server.
    expect(rows.find(row => row.id === 'lsp')?.name).toBe('@deepseek-ai/dsh-lsp')
    expect(rows.find(row => row.id === 'lsp-stdio')?.config).toMatchObject({
      servers: { go: { command: 'gopls', extensionToLanguage: { '.go': 'go' } } },
    })
    // Disabled: the provider resolves its commands at load, so an enabled row
    // would stop a host without gopls from booting.
    expect(rows.find(row => row.id === 'lsp-stdio')?.disabled).toBe(true)
    expect(rows.find(row => row.id === 'tool-lsp')?.name).toBe('@deepseek-ai/dsh-tool-lsp')
    expect(rows.find(row => row.id === 'tool-lsp-map')?.name).toBe('@deepseek-ai/dsh-tool-lsp-map')
    // Workspace snapshot capture is host-plane, so every surface records it.
    expect(rows.find(row => row.id === 'checkpoint')).toMatchObject({
      name: '@deepseek-ai/dsh-checkpoint',
      config: { enabled: true },
    })
    for (const name of [
      '@deepseek-ai/dsh-lsp', '@deepseek-ai/dsh-lsp-stdio',
      '@deepseek-ai/dsh-tool-lsp', '@deepseek-ai/dsh-tool-lsp-map',
      '@deepseek-ai/dsh-checkpoint',
    ]) {
      expect(manifest.dependencies, name).toHaveProperty(name)
    }
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-shell-search')
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-subagent-codex')
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-subagent-claude-code')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-web-fetch-http')
  })

  it('gates each shell stack by platform with a symmetric disabled expression', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('base patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
        : [],
    )
    // Symmetric gating: each stack's executor and tool rows carry the same
    // platform fact, inverted between the bash and pwsh twins, so exactly one
    // shell stack mounts per host. Evaluate with a platform-scoped context
    // (the `with` scope shadows the global `process`) so both outcomes pin on
    // every host.
    for (const [id, win32, linux] of [
      ['bash-sandbox', true, false],
      ['tool-bash', true, false],
      ['pwsh-sandbox', false, true],
      ['tool-pwsh', false, true],
    ] as const) {
      const row = rows.find(candidate => candidate.id === id)
      if (row === undefined) throw new Error(`base patch must mount ${id}`)
      const expression = (row.disabled as { __jsExpr?: string } | undefined)?.__jsExpr
      if (expression === undefined) throw new Error(`${id} must gate on a !!js disabled expression`)
      expect(Boolean(evaluate({ process: { platform: 'win32' } }, expression)), `${id} on win32`).toBe(win32)
      expect(Boolean(evaluate({ process: { platform: 'linux' } }, expression)), `${id} on linux`).toBe(linux)
    }
    // The platform layer folded into these rows: no separate patch file ships.
    expect(existsSync(resolve(root, 'windows.cordis.patch.yml'))).toBe(false)
  })
})
