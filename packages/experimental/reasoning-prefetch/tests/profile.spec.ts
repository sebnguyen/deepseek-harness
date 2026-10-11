/** The published bundle carries one parseable self-mounting layer. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('reasoning-prefetch profile bundle', () => {
  it('declares a published parseable layer mounting its own row', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      publishConfig?: { access?: string }
      dsh?: { bundle?: { patch?: string } }
    }
    // Public exception to the experimental private-by-default rule: joined
    // the release family so dsh-base can mount it.
    expect(manifest.private).toBeUndefined()
    expect(manifest.publishConfig?.access).toBe('public')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')

    const patchPath = manifest.dsh?.bundle?.patch
    expect(patchPath).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    const patches = parsed as {
      insert?: { id?: string; name?: string; config?: Record<string, unknown> }[]
    }[]
    const inserted = patches.flatMap(patch => patch.insert ?? [])
    expect(inserted.find(entry => entry.id === 'reasoning-prefetch')).toMatchObject({
      name: '@deepseek-ai/dsh-experimental-reasoning-prefetch',
    })
  })
})
