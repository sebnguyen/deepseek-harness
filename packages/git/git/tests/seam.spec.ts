/**
 * The git seam: registry semantics and execution-time selection. Duplicate
 * ids reject; the configured id wins when registered and available;
 * every refusal surfaces as its stable code; the entry cap truncates and
 * flags; reads pass through the selected provider.
 */
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { GitError, GitRuntime } from '../src/index.ts'
import type { GitDiffRequest, GitProvider, GitStatusRequest } from '../src/types.ts'

/** One scripted provider recording what it served. */
function provider(id: string, usable: boolean, entries: { path: string; status: 'modified' }[] = []): GitProvider & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    id,
    calls,
    available: () => usable,
    status: async (request: GitStatusRequest) => {
      calls.push(['status', request])
      return { head: 'oid', entries, truncated: false }
    },
    diff: async (request: GitDiffRequest) => {
      calls.push(['diff', request])
      return { path: request.path, oldText: 'old', newText: 'new' }
    },
  }
}

it('registers a provider, rejects duplicates, and unregisters on disposal', async () => {
  const ctx = new Context()
  const git = new GitRuntime(ctx)
  const first = provider('a', true)
  const dispose = git.registerProvider(first)
  try {
    git.registerProvider(provider('a', true))
    expect.unreachable('the duplicate must reject')
  } catch (error) {
    expect(error).toBeInstanceOf(GitError)
    expect((error as GitError).code).toBe('GIT_DUPLICATE_PROVIDER')
  }
  dispose()
  // The slot is free again after disposal.
  git.registerProvider(provider('a', true))
})

it('the configured id wins and a request may narrow the entry cap', async () => {
  const ctx = new Context()
  const git = new GitRuntime(ctx, { provider: 'a', maxEntries: 5 })
  const busy = provider('a', true, [{ path: 'x', status: 'modified' }, { path: 'y', status: 'modified' }])
  git.registerProvider(busy)
  const result = await git.status({ workspaceRoot: '/repo' })
  expect(result.entries).toHaveLength(2)
  const narrow = await git.status({ workspaceRoot: '/repo', maxEntries: 1 })
  expect(narrow.entries.map(entry => entry.path)).toEqual(['x'])
  expect(narrow.truncated).toBe(true)
})

it('caps results above the configured entry cap and flags truncation', async () => {
  const ctx = new Context()
  const git = new GitRuntime(ctx, { maxEntries: 1 })
  git.registerProvider(provider('a', true, [{ path: 'x', status: 'modified' }, { path: 'y', status: 'modified' }]))
  const result = await git.status({ workspaceRoot: '/repo' })
  expect(result.entries.map(entry => entry.path)).toEqual(['x'])
  expect(result.truncated).toBe(true)
})

it('diff passes the request through the selected provider unchanged', async () => {
  const ctx = new Context()
  const git = new GitRuntime(ctx)
  const only = provider('only', true)
  git.registerProvider(only)
  const diff = await git.diff({ workspaceRoot: '/repo', path: 'a.txt' })
  expect(diff).toMatchObject({ oldText: 'old', newText: 'new' })
  // The seam fills the byte cap the caller omitted before selecting.
  expect(only.calls[0]).toEqual([
    'diff', { workspaceRoot: '/repo', path: 'a.txt', maxFileBytes: 32 * 1024 * 1024 },
  ])
  // The diff cap defaults from the seam's configured byte cap.
  const capped = new GitRuntime(new Context(), { maxFileBytes: 7 })
  const capCalls: GitDiffRequest[] = []
  capped.registerProvider({
    ...only,
    diff: async (request) => {
      capCalls.push(request)
      return { path: request.path, oldText: '', newText: '' }
    },
  })
  await capped.diff({ workspaceRoot: '/repo', path: 'a.txt' })
  expect(capCalls[0]?.maxFileBytes).toBe(7)
})

it('a configured id that is missing or unavailable refuses with its code', async () => {
  const missing = new GitRuntime(new Context(), { provider: 'ghost' })
  missing.registerProvider(provider('a', true))
  await expect(missing.status({ workspaceRoot: '/repo' })).rejects.toMatchObject({ code: 'GIT_PROVIDER_CONFIGURED_MISSING' })
  const unavailable = new GitRuntime(new Context(), { provider: 'a' })
  unavailable.registerProvider(provider('a', false))
  await expect(unavailable.status({ workspaceRoot: '/repo' })).rejects.toMatchObject({ code: 'GIT_PROVIDER_CONFIGURED_UNAVAILABLE' })
})

it('no configuration selects the single usable provider and rejects ambiguity or absence', async () => {
  const none = new GitRuntime(new Context())
  none.registerProvider(provider('a', false))
  await expect(none.status({ workspaceRoot: '/repo' })).rejects.toMatchObject({ code: 'GIT_PROVIDER_UNAVAILABLE' })
  const ambiguous = new GitRuntime(new Context())
  ambiguous.registerProvider(provider('a', true))
  ambiguous.registerProvider(provider('b', true))
  await expect(ambiguous.status({ workspaceRoot: '/repo' })).rejects.toMatchObject({ code: 'GIT_PROVIDER_AMBIGUOUS' })
  const single = new GitRuntime(new Context())
  single.registerProvider(provider('a', true))
  single.registerProvider(provider('b', false))
  const result = await single.status({ workspaceRoot: '/repo' })
  expect(result.head).toBe('oid')
})
