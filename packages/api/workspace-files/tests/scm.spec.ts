/**
 * The `scmStatus` remote: a Host without the git seam answers absent; a
 * live seam maps its result; its not-a-repository refusal folds into the
 * `notRepository` face; any other refusal crosses unchanged.
 */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { openWorkspace, signal, type Harness } from './harness.ts'

let harness: Harness

beforeEach(async () => {
  harness = await openWorkspace('wffs-scm-')
})

afterEach(async () => {
  await harness.dispose()
})

it('answers present false on a Host without the git seam', async () => {
  const endpoint = harness.endpoint()
  expect(await endpoint.scmStatus(harness.scope, signal())).toEqual({ present: false })
})

it('maps the live seam result to the wire face', async () => {
  harness.ctx.provide('git', {
    status: async () => ({
      head: 'abc',
      entries: [{ path: 'a.txt', status: 'modified' }],
      truncated: true,
    }),
  } as never)
  const endpoint = harness.endpoint()
  expect(await endpoint.scmStatus(harness.scope, signal())).toEqual({
    present: true,
    notRepository: false,
    head: 'abc',
    entries: [{ path: 'a.txt', status: 'modified' }],
    truncated: true,
  })
})

it('folds the not-a-repository refusal into the notRepository face', async () => {
  harness.ctx.provide('git', {
    status: async (): Promise<never> => {
      throw Object.assign(new Error('not a repository'), { code: 'GIT_NOT_REPOSITORY' })
    },
  } as never)
  const endpoint = harness.endpoint()
  expect(await endpoint.scmStatus(harness.scope, signal())).toEqual({
    present: true,
    notRepository: true,
    head: null,
    entries: [],
    truncated: false,
  })
})

it('lets any other seam refusal cross unchanged', async () => {
  harness.ctx.provide('git', {
    status: async (): Promise<never> => {
      throw new Error('seam down')
    },
  } as never)
  const endpoint = harness.endpoint()
  await expect(endpoint.scmStatus(harness.scope, signal())).rejects.toThrow('seam down')
})
