import { describe, expect, it } from 'vitest'
import { catalogModels, catalogProvider, catalogProviderIds } from '../src/catalog.ts'
import { resolveProfiles } from '../src/config.ts'

describe('dbg', () => {
  it('prints catalog state', () => {
    console.log('DBG ids', JSON.stringify(catalogProviderIds()))
    console.log('DBG do size', catalogModels('digitalocean').size, [...catalogModels('digitalocean').keys()])
    console.log('DBG do provider?', catalogProvider('digitalocean')?.id)
    const resolved = resolveProfiles({ digitalocean: { apiKeyEnv: 'LIVE_KEY', baseURL: 'http://127.0.0.1:9/v1' } }, 'deferred')
    const profile = resolved.get('digitalocean')
    console.log('DBG live', profile?.live, 'models', profile ? (profile as { models?: unknown[] }).models?.length : 'n/a')
    console.log('DBG profile keys', profile && Object.keys(profile))
    expect(true).toBe(true)
  })
})
