// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GuideHome } from '../src/client/GuideHome.tsx'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh, params?: Record<string, string>): string => {
  const template = zh[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

afterEach(cleanup)

describe('guide home', () => {
  it('opens the capability roster from the trigger and keeps it out of the column until then', () => {
    render(<GuideHome wide t={t} />)
    expect(screen.queryByRole('article')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['section.title'] }))
    expect(screen.getByText(zh['section.lede'])).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(9)
    expect(screen.getByText(zh['guide.sandbox.title'])).toBeTruthy()
    expect(screen.getByText(zh['guide.plugins.description'])).toBeTruthy()
  })

  it('keeps a trigger in the collapsed rail', () => {
    render(<GuideHome wide={false} t={t} />)
    expect(screen.getByRole('button', { name: zh['section.title'] })).toBeTruthy()
    expect(screen.queryByRole('article')).toBeNull()
  })

  it('renders nothing without its dictionary', () => {
    const { container } = render(<GuideHome wide />)
    expect(container.firstChild).toBeNull()
  })
})
