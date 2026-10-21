import { describe, expect, it } from 'vitest'
import { adoptionEntries, capacityOf, draftErrors, entryWith, rowOps } from '../src/client/provider/rules.ts'

describe('provider draft rules', () => {
  it('accepts passing drafts and reports each violation alone', () => {
    expect(draftErrors({ temp: '0.35', ctx: '382K', max: '32K' }, 391_168)).toEqual({})
    expect(draftErrors({ temp: '1.5', ctx: '', max: '' }, undefined).temp).toContain('0-1')
    expect(draftErrors({ temp: '', ctx: '999K', max: '' }, 391_168).ctx).toContain('ceiling')
    expect(draftErrors({ temp: '', ctx: 'banana', max: '' }, undefined).ctx).toContain('whole number')
    expect(draftErrors({ temp: '', ctx: '250K', max: '300K' }, undefined).max).toContain('context window')
    expect(draftErrors({ temp: '', ctx: '', max: 'nope' }, undefined).max).toContain('whole number')
  })

  it('rejects capacities that are not whole positive counts', () => {
    expect(capacityOf('1.5K')).toBe(1_500)
    expect(capacityOf('1.5')).toBeUndefined()
    expect(capacityOf('382K')).toBe(382_000)
    expect(capacityOf('')).toBeUndefined()
  })

  it('turns passing drafts into set/unset operations', () => {
    expect(rowOps(['providers', 'digitalocean', 'models', '0'], {
      temp: '0.3',
      ctx: '382K',
      max: '',
      effort: 'high',
    })).toEqual([
      { op: 'set', path: ['providers', 'digitalocean', 'models', '0', 'tunes', 'temperature'], value: 0.3 },
      { op: 'set', path: ['providers', 'digitalocean', 'models', '0', 'tunes', 'reasoningEffort'], value: 'high' },
      { op: 'set', path: ['providers', 'digitalocean', 'models', '0', 'contextWindow'], value: 382_000 },
      { op: 'unset', path: ['providers', 'digitalocean', 'models', '0', 'maxTokens'] },
    ])
  })

  it('adopts only unknown ids additively, as full entries', () => {
    expect(adoptionEntries(
      new Set(['known']),
      [
        { id: 'known', contextWindow: 999, maxTokens: 999 },
        { id: 'fresh', contextWindow: 100_000 },
        { id: 'bare' },
      ],
      { contextWindow: 262_144, maxTokens: 32_768 },
    )).toEqual([
      { id: 'fresh', contextWindow: 100_000, maxTokens: 20_000 },
      { id: 'bare', contextWindow: 262_144, maxTokens: 32_768 },
    ])
    // A window-sized advertised cap clamps to one fifth of the window.
    expect(adoptionEntries(
      new Set(),
      [{ id: 'deepseek-v4.1-flash', contextWindow: 1_048_576, maxTokens: 1_048_576 }],
      { contextWindow: 262_144, maxTokens: 32_768 },
    )).toEqual([
      { id: 'deepseek-v4.1-flash', contextWindow: 1_048_576, maxTokens: 209_715 },
    ])
    // A genuinely small advertised cap survives the clamp.
    expect(adoptionEntries(
      new Set(),
      [{ id: 'gemma', contextWindow: 256_000, maxTokens: 8_192 }],
      { contextWindow: 262_144, maxTokens: 32_768 },
    )).toEqual([
      { id: 'gemma', contextWindow: 256_000, maxTokens: 8_192 },
    ])
    expect(adoptionEntries(
      new Set(),
      [{ id: 'fresh' }],
      { contextWindow: 1, maxTokens: 2 },
      { low: 'low', high: 'high' },
    )).toEqual([
      { id: 'fresh', contextWindow: 1, maxTokens: 1, reasoningEfforts: { low: 'low', high: 'high' } },
    ])
    expect(adoptionEntries(
      new Set(),
      [{ id: 'all-mini-lm-l6-v2' }],
      { contextWindow: 1, maxTokens: 2 },
      {},
    )).toEqual([
      { id: 'all-mini-lm-l6-v2', contextWindow: 1, maxTokens: 1 },
    ])
  })

  it('pins a resolved entry with the drafted knobs and drops blanked ones', () => {
    const raw = { id: 'm', contextWindow: 1000, maxTokens: 10, tunes: { temperature: 0.5, reasoningEffort: 'low' }, extra: 'kept' }
    expect(entryWith(raw, { temp: '0.3', ctx: '', max: '20' }, 'high')).toEqual({
      id: 'm',
      maxTokens: 20,
      tunes: { temperature: 0.3, reasoningEffort: 'high' },
      extra: 'kept',
    })
    expect(entryWith({ id: 'm' }, { temp: '', ctx: '2K', max: '' }, undefined))
      .toEqual({ id: 'm', contextWindow: 2000 })
  })
})
