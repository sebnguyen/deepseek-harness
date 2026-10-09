/**
 * The `write` operation: guarded saves over the real local backend, including
 * the stale-version race against a concurrent writer and the read-only latch.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { failureOf, openWorkspace, signal, type Harness } from './harness.ts'

let harness: Harness

beforeEach(async () => {
  harness = await openWorkspace('wffs-write-')
})

afterEach(async () => {
  await harness.dispose()
})

it('creates a file when the save names no version', async () => {
  const endpoint = harness.endpoint()
  const stat = await endpoint.write(harness.scope, 'new.txt', 'hello\n', undefined, signal())
  expect(stat.absolutePath).toBe(join(harness.workspace, 'new.txt'))
  expect(stat.version).not.toBe('')
  expect(await readFile(join(harness.workspace, 'new.txt'), 'utf8')).toBe('hello\n')
})

it('replaces exactly the named version and reports the next one', async () => {
  await writeFile(join(harness.workspace, 'edit.txt'), 'one\n')
  const endpoint = harness.endpoint()
  const before = await endpoint.stat(harness.scope, 'edit.txt', signal())
  const after = await endpoint.write(harness.scope, 'edit.txt', 'two\n', before.version, signal())
  expect(after.version).not.toBe(before.version)
  expect(await readFile(join(harness.workspace, 'edit.txt'), 'utf8')).toBe('two\n')
})

it('refuses a save whose named version a concurrent writer moved', async () => {
  await writeFile(join(harness.workspace, 'raced.txt'), 'base\n')
  const endpoint = harness.endpoint()
  const before = await endpoint.stat(harness.scope, 'raced.txt', signal())
  await writeFile(join(harness.workspace, 'raced.txt'), 'concurrent\n')
  const failure = await failureOf(endpoint.write(harness.scope, 'raced.txt', 'mine\n', before.version, signal()))
  expect(failure.code).toBe('workspace-file/stale')
  expect(failure.details).toMatchObject({ path: 'raced.txt' })
  expect(await readFile(join(harness.workspace, 'raced.txt'), 'utf8')).toBe('concurrent\n')
})

it('refuses to save over a directory', async () => {
  await mkdir(join(harness.workspace, 'adir'))
  const endpoint = harness.endpoint()
  const failure = await failureOf(endpoint.write(harness.scope, 'adir', 'x', undefined, signal()))
  expect(failure.code).toBe('workspace-file/not-regular-file')
  expect(failure.details).toMatchObject({ path: 'adir', kind: 'directory' })
})

it('refuses a save above the configured file cap without truncating', async () => {
  const endpoint = harness.endpoint({ maxFileBytes: 8 })
  const failure = await failureOf(endpoint.write(harness.scope, 'big.txt', '0123456789', undefined, signal()))
  expect(failure.code).toBe('workspace-file/too-large')
  expect(failure.details).toMatchObject({ path: 'big.txt', limit: 8 })
})

it('refuses every save while the Session is read-only', async () => {
  const readOnly = await openWorkspace('wffs-write-ro-', 'read-only')
  try {
    const endpoint = readOnly.endpoint()
    const failure = await failureOf(endpoint.write(readOnly.scope, 'any.txt', 'x', undefined, signal()))
    expect(failure.code).toBe('workspace-file/read-only')
    expect(failure.details).toMatchObject({ path: 'any.txt' })
  } finally {
    await readOnly.dispose()
  }
})

it('mints a human save stop with the replaced text, and none beyond its caps', async () => {
  await writeFile(join(harness.workspace, 'noted.txt'), 'one\n')
  type Capture = {
    call: { name: string; purpose?: string; agent?: { session?: unknown } }
    file: { before: string | null; after: string }
  }
  const captures: Capture[] = []
  const session = { header: { cwd: harness.workspace }, append: () => {} }
  harness.ctx.provide('sessions', {
    get: (id: string) => (id === 's-test' ? session : undefined),
  } as never)
  harness.ctx.provide('checkpoint', {
    captureWrite: async (call: never, file: never) => {
      captures.push({ call, file })
    },
  } as never)
  const endpoint = harness.endpoint()
  await endpoint.write(harness.scope, 'noted.txt', 'two\n', undefined, signal())
  expect(captures).toHaveLength(1)
  expect(captures[0]?.file).toMatchObject({ before: 'one\n', after: 'two\n' })
  expect(captures[0]?.call).toMatchObject({ name: 'human-save', purpose: 'human save' })
  expect(captures[0]?.call.agent?.session).toBe(session)
  // A new file carries no before side.
  await endpoint.write(harness.scope, 'fresh.txt', 'x', undefined, signal())
  expect(captures[1]?.file).toMatchObject({ before: null, after: 'x' })
  // A prior above the cap keeps the stop on its after side alone.
  const capped = await openWorkspace('wffs-write-cap-', 'workspace-write')
  try {
    await writeFile(join(capped.workspace, 'big.txt'), '0'.repeat(64))
    capped.ctx.provide('sessions', { get: () => session } as never)
    capped.ctx.provide('checkpoint', {
      captureWrite: async (call: never, file: never) => {
        captures.push({ call, file })
      },
    } as never)
    const cappedEndpoint = capped.endpoint({ maxFileBytes: 8 })
    await cappedEndpoint.write(capped.scope, 'big.txt', 'small', undefined, signal())
    expect(captures[2]?.file).toMatchObject({ before: null, after: 'small' })
  } finally {
    await capped.dispose()
  }
})

it('records nothing when the session is not live', async () => {
  await writeFile(join(harness.workspace, 'alone.txt'), 'one\n')
  const captures: unknown[] = []
  harness.ctx.provide('checkpoint', {
    captureWrite: async (call: never, file: never) => {
      captures.push({ call, file })
    },
  } as never)
  const endpoint = harness.endpoint()
  await endpoint.write(harness.scope, 'alone.txt', 'two\n', undefined, signal())
  expect(captures).toEqual([])
})

it('propagates a backend write failure that is not a version refusal', async () => {
  await writeFile(join(harness.workspace, 'parent.txt'), 'file\n')
  const endpoint = harness.endpoint()
  await expect(endpoint.write(harness.scope, 'parent.txt/child.txt', 'x', undefined, signal())).rejects.toBeDefined()
  await chmod(harness.workspace, 0o555)
  try {
    await expect(endpoint.write(harness.scope, 'locked.txt', 'x', undefined, signal())).rejects.toBeDefined()
  } finally {
    await chmod(harness.workspace, 0o755)
  }
})
