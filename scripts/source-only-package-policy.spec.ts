/** Source-only package directory classification. */

import { describe, expect, it } from 'vitest'
import {
  isSourceOnlyPackageDirectory,
  SOURCE_ONLY_PACKAGE_DIRECTORY_ROOTS,
} from './source-only-package-policy.ts'

describe('source-only package policy', () => {
  it('names the Coral group and Orchestration package', () => {
    expect(SOURCE_ONLY_PACKAGE_DIRECTORY_ROOTS).toEqual([
      'packages/coral',
      'packages/client/ui-orchestration',
    ])
  })

  it.each([
    'packages/coral',
    'packages/coral/coral',
    'packages/coral/transport-inproc',
    'packages/client/ui-orchestration',
  ])('classifies %s as source-only', (directory) => {
    expect(isSourceOnlyPackageDirectory(directory)).toBe(true)
  })

  it.each([
    'packages/coral-extra',
    'packages/coral-extra/coral',
    'packages/client/ui-orchestration-extra',
    'packages/client/ui-turbo',
    'packages/experimental/reasoning-prefetch',
  ])('classifies %s as an ordinary workspace package', (directory) => {
    expect(isSourceOnlyPackageDirectory(directory)).toBe(false)
  })
})
