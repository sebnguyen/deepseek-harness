import { describe, expect, it } from 'vitest'
import { deriveKeyRef, formatCapacity, parseCapacity } from '../src/capacity.ts'

describe('capacity vocabulary', () => {
  it('parses counts with K/M spellings and plain numbers', () => {
    expect(parseCapacity('382K')).toBe(382_000)
    expect(parseCapacity('1M')).toBe(1_000_000)
    expect(parseCapacity('65536')).toBe(65_536)
    expect(parseCapacity('2.5k')).toBe(2_500)
    expect(parseCapacity('  ')).toBeUndefined()
    expect(parseCapacity('banana')).toBeNaN()
    expect(parseCapacity('1.5')).toBe(1.5)
  })

  it('formats stored counts in the shortest round-tripping spelling', () => {
    expect(formatCapacity(382_000)).toBe('382K')
    expect(formatCapacity(1_000_000)).toBe('1M')
    expect(formatCapacity(65_536)).toBe('65536')
    expect(formatCapacity(-2)).toBe('-2')
    expect(formatCapacity(1.5)).toBe('1.5')
    expect(parseCapacity(formatCapacity(382_000))).toBe(382_000)
  })

  it('derives the conventional credential reference', () => {
    expect(deriveKeyRef('digitalocean')).toBe('DIGITALOCEAN_API_KEY')
    expect(deriveKeyRef('minimax-cn')).toBe('MINIMAX_CN_API_KEY')
  })
})
