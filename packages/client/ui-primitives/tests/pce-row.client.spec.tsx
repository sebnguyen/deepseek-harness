// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PceRow } from '../src/pce/PceRow.tsx'

const body = <span>expanded body</span>

afterEach(cleanup)

describe('PceRow pixel marks', () => {
  it('renders the leading kind glyph and the trailing state mark by default', () => {
    const { container } = render(
      <PceRow kind="bash" glyph="bash" title="Bash" state="ok" body={null} />,
    )
    expect(container.querySelector('.pce-mark')).not.toBeNull()
    expect(container.querySelector('.pce-head-state')).not.toBeNull()
  })

  it('omits both pixel marks when marks is false', () => {
    const { container } = render(
      <PceRow kind="bash" glyph="bash" title="Bash" state="ok" marks={false} body={null} />,
    )
    expect(container.querySelector('.pce-mark')).toBeNull()
    expect(container.querySelector('.pce-head-state')).toBeNull()
  })
})

describe('PceRow expanded-body gutter', () => {
  it('wraps the body so the description column owns the indent', () => {
    const { container } = render(
      <PceRow kind="bash" glyph="bash" title="Bash" summary="List files" body={body} defaultOpen />,
    )
    const article = container.querySelector('.pce')
    expect(article?.hasAttribute('data-pce-description')).toBe(true)
    expect(article?.hasAttribute('data-pce-marks')).toBe(false)
    const bodyElement = container.querySelector('.pce-body')
    expect(bodyElement?.firstElementChild?.classList.contains('pce-body-gutter')).toBe(true)
    expect(bodyElement?.querySelector('.pce-body-content')?.textContent).toBe('expanded body')
  })

  it('marks a summary-less row for the mark-only gutter', () => {
    const { container } = render(
      <PceRow kind="bash" glyph="bash" title="Bash" body={body} defaultOpen />,
    )
    expect(container.querySelector('.pce')?.hasAttribute('data-pce-description')).toBe(false)
  })

  it('marks a marks-off row so the gutter drops the glyph cell', () => {
    const { container } = render(
      <PceRow kind="bash" glyph="bash" title="Bash" summary="List files" marks={false} body={body} defaultOpen />,
    )
    expect(container.querySelector('.pce')?.getAttribute('data-pce-marks')).toBe('false')
    expect(container.querySelector('.pce-body .pce-body-gutter')).not.toBeNull()
  })
})

describe('PceRow expanded-body marker', () => {
  it('marks a toggled-open body so only it takes the inset', () => {
    const { container } = render(<PceRow kind="bash" glyph="bash" title="Bash" body={body} defaultOpen />)
    expect(container.querySelector('.pce-body')?.hasAttribute('data-pce-expanded')).toBe(true)
  })

  it('leaves an always-open body unmarked', () => {
    const { container } = render(
      <PceRow kind="command" glyph="adjust" title="Command" collapsible={false} body={body} />,
    )
    expect(container.querySelector('.pce-body')?.hasAttribute('data-pce-expanded')).toBe(false)
  })

  it('leaves the keepMounted collapsed body unmarked', () => {
    const { container } = render(
      <PceRow kind="retry" glyph="reload" title="Retry" keepMounted body={body} />,
    )
    const hidden = container.querySelector('.pce-body')
    expect(hidden?.hasAttribute('hidden')).toBe(true)
    expect(hidden?.hasAttribute('data-pce-expanded')).toBe(false)
  })

  it('marks the body when the head opens it', () => {
    const { container } = render(<PceRow kind="bash" glyph="bash" title="Bash" body={body} />)
    const head = container.querySelector('.pce-head')
    if (head === null) throw new Error('head missing')
    fireEvent.click(head)
    expect(container.querySelector('.pce-body')?.hasAttribute('data-pce-expanded')).toBe(true)
  })
})
