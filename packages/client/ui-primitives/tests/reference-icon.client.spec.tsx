// @vitest-environment jsdom
/**
 * Reference glyph coverage: every reference domain renders one current-color
 * SVG, the snapshot domain included.
 */
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ReferenceIcon, type ReferenceIconKind } from '../src/ReferenceIcon.tsx'

afterEach(cleanup)

describe('ReferenceIcon', () => {
  it('renders one glyph per reference kind', () => {
    for (const kind of ['session', 'file', 'folder', 'snapshot'] as readonly ReferenceIconKind[]) {
      const { container, unmount } = render(createElement(ReferenceIcon, { kind }))
      expect(container.querySelector('svg')).not.toBeNull()
      unmount()
    }
  })
})
