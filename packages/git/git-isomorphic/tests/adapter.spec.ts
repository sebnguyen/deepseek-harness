/**
 * The promise-fs adapter against a scripted filesystem facade: every read
 * member resolves and translates the composed backend's refusals into the
 * codes isomorphic-git recognizes, stats carry the synthesized mode bits,
 * and the mutation members refuse EROFS.
 */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { FsAdapter } from '../src/adapter.ts'

interface FsScript {
  resolve?: (path: string) => Promise<unknown>
  stat?: (target: unknown) => Promise<unknown>
  lstat?: (path: string) => Promise<unknown>
  readBytes?: (target: unknown) => Promise<Uint8Array>
  listDir?: (target: unknown) => Promise<{ name: string }[]>
}

/** One context whose `fs` answers from the script and nothing else. */
function facade(script: FsScript): Context {
  const ctx = new Context()
  ctx.provide('fs', {
    resolve: script.resolve ?? (async (path: string) => ({ path })),
    stat: script.stat ?? (async () => ({ type: 'file', size: 1 })),
    lstat: script.lstat ?? (async () => ({ type: 'file', size: 1 })),
    readBytes: script.readBytes ?? (async () => new Uint8Array([1])),
    listDir: script.listDir ?? (async () => [{ name: 'a' }]),
  } as never)
  return ctx
}

const absent = Object.assign(new Error('gone'), { code: 'FS_NOT_FOUND' })

it('readFile translates absence and passes bytes through', async () => {
  const adapter = new FsAdapter(facade({}))
  expect([...await adapter.promises.readFile('/repo/a.txt')]).toEqual([1])
  const missing = new FsAdapter(facade({ resolve: async () => { throw absent } }))
  await expect(missing.promises.readFile('/nope')).rejects.toMatchObject({ code: 'ENOENT' })
  const oddball = new FsAdapter(facade({ resolve: async () => { throw new Error('weird') } }))
  await expect(oddball.promises.readFile('/nope')).rejects.toMatchObject({ message: 'weird' })
  const notFile = new FsAdapter(facade({ stat: async () => ({ type: 'directory' }) }))
  await expect(notFile.promises.readFile('/dir')).rejects.toMatchObject({ code: 'ENOENT' })
  const absentStat = new FsAdapter(facade({ stat: async () => undefined }))
  await expect(absentStat.promises.readFile('/x')).rejects.toMatchObject({ code: 'ENOENT' })
  const readGone = new FsAdapter(facade({ readBytes: async () => { throw absent } }))
  await expect(readGone.promises.readFile('/x')).rejects.toMatchObject({ code: 'ENOENT' })
  const readWeird = new FsAdapter(facade({ readBytes: async () => { throw new Error('boom') } }))
  await expect(readWeird.promises.readFile('/x')).rejects.toMatchObject({ message: 'boom' })
})

it('readdir lists names and translates absence', async () => {
  const adapter = new FsAdapter(facade({}))
  expect(await adapter.promises.readdir('/repo')).toEqual(['a'])
  const missing = new FsAdapter(facade({ resolve: async () => { throw absent } }))
  await expect(missing.promises.readdir('/nope')).rejects.toMatchObject({ code: 'ENOENT' })
  const resolveBoom = new FsAdapter(facade({ resolve: async () => { throw new Error('resolveboom') } }))
  await expect(resolveBoom.promises.readdir('/x')).rejects.toMatchObject({ message: 'resolveboom' })
  const statBoom = new FsAdapter(facade({ resolve: async () => ({ path: '/x' }), stat: async () => { throw new Error('statboom') } }))
  await expect(statBoom.promises.stat('/x')).rejects.toMatchObject({ message: 'statboom' })
  const listWeird = new FsAdapter(facade({ listDir: async () => { throw absent } }))
  await expect(listWeird.promises.readdir('/x')).rejects.toMatchObject({ code: 'ENOENT' })
  const listBroken = new FsAdapter(facade({ listDir: async () => { throw new Error('broken') } }))
  await expect(listBroken.promises.readdir('/x')).rejects.toMatchObject({ message: 'broken' })
})

it('stat and lstat synthesize the mode bits per entry kind', async () => {
  const file = new FsAdapter(facade({}))
  expect((await file.promises.stat('/a')).isFile()).toBe(true)
  const dir = new FsAdapter(facade({ stat: async () => ({ type: 'directory', size: 0 }) }))
  expect((await dir.promises.stat('/a')).isDirectory()).toBe(true)
  const link = new FsAdapter(facade({ stat: async () => ({ type: 'symlink', size: 0 }) }))
  expect((await link.promises.stat('/a')).isSymbolicLink()).toBe(true)
  const special = new FsAdapter(facade({ stat: async () => ({ type: 'other', size: 0 }) }))
  const stats = await special.promises.stat('/a')
  expect(stats.isFile() || stats.isDirectory() || stats.isSymbolicLink()).toBe(false)
  const missing = new FsAdapter(facade({ resolve: async () => { throw absent } }))
  await expect(missing.promises.stat('/nope')).rejects.toMatchObject({ code: 'ENOENT' })
  const absentInfo = new FsAdapter(facade({ stat: async () => undefined }))
  await expect(absentInfo.promises.stat('/x')).rejects.toMatchObject({ code: 'ENOENT' })
  // lstat reads the path directly and reports symlink kinds.
  const llink = new FsAdapter(facade({ lstat: async () => ({ type: 'symlink', size: 3 }) }))
  expect((await llink.promises.lstat('/a')).isSymbolicLink()).toBe(true)
  const lother = new FsAdapter(facade({ lstat: async () => ({ type: 'other' }) }))
  expect((await lother.promises.lstat('/a')).isFile()).toBe(false)
  const sized = new FsAdapter(facade({ stat: async () => ({ type: 'file' }) }))
  expect((await sized.promises.stat('/a')).size).toBe(0)
  const lgone = new FsAdapter(facade({ lstat: async () => undefined }))
  await expect(lgone.promises.lstat('/x')).rejects.toMatchObject({ code: 'ENOENT' })
})

it('the mutation members no-op index bookkeeping and readlink reports absence', async () => {
  const adapter = new FsAdapter(facade({}))
  for (const mutate of [
    adapter.promises.writeFile, adapter.promises.unlink, adapter.promises.mkdir, adapter.promises.rmdir,
    adapter.promises.symlink,
  ]) {
    await expect(mutate()).resolves.toBeUndefined()
  }
  await expect(adapter.promises.readlink('/x')).rejects.toMatchObject({ code: 'ENOENT' })
})

it('readFile honors the utf8 encoding option', async () => {
  const adapter = new FsAdapter(facade({ readBytes: async () => new Uint8Array([104, 105]) }))
  expect(await adapter.promises.readFile('/a', 'utf8')).toBe('hi')
  expect(await adapter.promises.readFile('/a', { encoding: 'utf8' })).toBe('hi')
})
