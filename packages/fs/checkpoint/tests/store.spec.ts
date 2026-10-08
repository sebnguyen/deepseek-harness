/** Covers the content-addressed checkpoint store: digests, idempotence, frontier persistence. */

import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CheckpointStore, digestOf } from '../src/index.ts'
import type { SnapshotDigest } from '../src/types.ts'

/** Build a store rooted at a fresh temp session directory. */
async function tempStore(): Promise<{ root: string; store: CheckpointStore }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-checkpoint-store-'))
  return { root, store: new CheckpointStore(root) }
}

describe('digestOf', () => {
  it('addresses content by a stable sha256 digest', () => {
    expect(digestOf('one')).toBe(digestOf('one'))
    expect(digestOf('one')).not.toBe(digestOf('two'))
    expect(digestOf('one').startsWith('sha256:')).toBe(true)
    expect(digestOf('one').slice('sha256:'.length)).toHaveLength(64)
  })
})

describe('CheckpointStore', () => {
  it('stores content idempotently and reads it back', async () => {
    const { root, store } = await tempStore()
    const digest = await store.put('alpha')
    expect(await store.has(digest)).toBe(true)
    expect(await store.read(digest)).toBe('alpha')

    // A second store of equal content is a stat-only no-op, never a rewrite.
    const before = await stat(join(root, 'objects', digest.slice(7, 9), digest.slice(7)))
    expect(await store.put('alpha')).toBe(digest)
    const after = await stat(join(root, 'objects', digest.slice(7, 9), digest.slice(7)))
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('hardens the object directory and file modes', async () => {
    const { root, store } = await tempStore()
    const digest = await store.put('beta')
    const dirMode = (await stat(join(root, 'objects', digest.slice(7, 9)))).mode & 0o777
    const fileMode = (await stat(join(root, 'objects', digest.slice(7, 9), digest.slice(7)))).mode & 0o777
    expect(dirMode).toBe(0o700)
    expect(fileMode).toBe(0o600)
  })

  it('resolves unknown digests as absent instead of throwing', async () => {
    const { store } = await tempStore()
    const missing = 'sha256:0000000000000000000000000000000000000000000000000000000000000000' as SnapshotDigest
    expect(await store.read(missing)).toBeNull()
    expect(await store.has(missing)).toBe(false)
  })

  it('round-trips the frontier file with sorted keys and stored stats', async () => {
    const { root, store } = await tempStore()
    expect([...(await store.loadFrontier()).after.keys()]).toEqual([])
    const digest = digestOf('gamma')
    await store.saveFrontier(
      new Map([['a.txt', { mtimeMs: 5, size: 1 }], ['b.txt', { mtimeMs: 6, size: 2 }]]),
      new Map([['b.txt', digest], ['a.txt', digest]]),
    )
    expect(JSON.parse(await readFile(join(root, 'frontier.json'), 'utf8'))).toEqual({
      'a.txt': { digest, mtimeMs: 5, size: 1 },
      'b.txt': { digest, mtimeMs: 6, size: 2 },
    })
    const loaded = await store.loadFrontier()
    expect([...loaded.after.entries()]).toEqual([['a.txt', digest], ['b.txt', digest]])
    expect([...loaded.stat.entries()]).toEqual([['a.txt', { mtimeMs: 5, size: 1 }], ['b.txt', { mtimeMs: 6, size: 2 }]])
  })

  it('keeps a digest that has no stat, and drops a stat that is not finite', async () => {
    const { root, store } = await tempStore()
    const digest = digestOf('gamma')
    await store.saveFrontier(new Map(), new Map([['a.txt', digest]]))
    const digestOnly = await store.loadFrontier()
    expect([...digestOnly.after.entries()]).toEqual([['a.txt', digest]])
    expect(digestOnly.stat.size).toBe(0)

    await writeFile(join(root, 'frontier.json'), JSON.stringify({
      'a.txt': { digest, mtimeMs: Number.NaN, size: 1 },
      'b.txt': { digest, mtimeMs: 1, size: -1 },
    }), 'utf8')
    const dropped = await store.loadFrontier()
    expect([...dropped.after.keys()]).toEqual(['a.txt', 'b.txt'])
    expect(dropped.stat.size).toBe(0)
  })

  it('treats a malformed frontier as empty and still accepts a legacy digest string', async () => {
    const { root, store } = await tempStore()
    await writeFile(join(root, 'frontier.json'), 'not json', 'utf8')
    expect((await store.loadFrontier()).after.size).toBe(0)
    await writeFile(join(root, 'frontier.json'), JSON.stringify({
      'a.txt': 7,
      'b.txt': 'sha256:x',
      'c.txt': null,
      'd.txt': { digest: 1 },
    }), 'utf8')
    const legacy = await store.loadFrontier()
    expect([...legacy.after.entries()]).toEqual([['b.txt', 'sha256:x']])
    expect(legacy.stat.size).toBe(0)
    await writeFile(join(root, 'frontier.json'), JSON.stringify('text'), 'utf8')
    expect((await store.loadFrontier()).after.size).toBe(0)
  })
})
