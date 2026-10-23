/** The web-app bundle's declared profile patch. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const root = fileURLToPath(new URL('..', import.meta.url))

interface BundleManifest {
  dependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}

interface PatchRow {
  id?: string
  name?: string
  disabled?: boolean
}

function readManifest(): BundleManifest {
  return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as BundleManifest
}

/** The `insert` rows this bundle's patch declares, flattened in file order. */
function insertRows(manifest: BundleManifest): PatchRow[] {
  const patches = yaml.load(
    readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
    { schema: entryListSchema },
  ) as Array<{ insert?: PatchRow[] }>
  return patches.flatMap(patch => patch.insert ?? [])
}

describe('dsh-web-app bundle patch', () => {
  it('keeps the claim status UI disabled with its projection', () => {
    const manifest = readManifest()
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-client-ui-claim')
    const rows = insertRows(manifest)
    expect(rows.find(row => row.id === 'ui-claim')).toMatchObject({ name: '@deepseek-ai/dsh-client-ui-claim', disabled: true })
    expect(rows.some(row => row.id === 'ui-context-window')).toBe(false)
  })

  it('parks the broken vscode planes out of the seat roster', () => {
    const rows = insertRows(readManifest())
    expect(rows.find(row => row.id === 'vscode-timeline')).toMatchObject({ name: '@deepseek-ai/dsh-vscode-timeline', disabled: true })
    expect(rows.find(row => row.id === 'vscode-line-notes')).toMatchObject({ name: '@deepseek-ai/dsh-vscode-line-notes', disabled: true })
  })
})
