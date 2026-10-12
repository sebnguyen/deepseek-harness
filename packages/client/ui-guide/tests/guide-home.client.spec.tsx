// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GuideHome } from '../src/client/GuideHome.tsx'
import { zh } from '../src/client/locales.ts'

const t = (key: keyof typeof zh, params?: Record<string, string>): string => {
  const template = zh[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

/** Let the FLIP morph's requestAnimationFrame pass (jsdom rects are 0×0, so it no-ops). */
const frames = (): Promise<void> =>
  new Promise((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve() }) }) })

/** The morph finishes on a 580ms timer in the component. */
const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

const domRect = ({ left, top, width, height }: { left: number; top: number; width: number; height: number }): DOMRect =>
  ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) })

/** Give jsdom a measurable stage geometry so the FLIP morph takes its animated path. */
const stubRects = () =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute('role') === 'dialog') return domRect({ left: 120, top: 60, width: 920, height: 640 })
    if (this.tagName === 'ARTICLE') return domRect({ left: 140, top: 200, width: 280, height: 138 })
    return domRect({ left: 0, top: 0, width: 100, height: 40 })
  })

afterEach(cleanup)
afterEach(() => { vi.restoreAllMocks() })

describe('guide home', () => {
  const openGuide = () => {
    render(<GuideHome wide t={t} />)
    fireEvent.click(screen.getByRole('button', { name: zh['section.title'] }))
  }

  it('opens the capability roster from the trigger and keeps it out of the column until then', () => {
    render(<GuideHome wide t={t} />)
    expect(screen.queryByRole('article')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['section.title'] }))
    expect(screen.getByText(zh['section.lede'])).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(9)
    expect(screen.getByText(zh['guide.sandbox.title'])).toBeTruthy()
    expect(screen.getByText(zh['guide.plugins.description'])).toBeTruthy()
  })

  it('expands a card into a full stage with its sea, copy, and chips', async () => {
    openGuide()
    fireEvent.click(screen.getByRole('article', { name: zh['guide.sandbox.title'] }))
    await frames()
    const stage = screen.getByRole('dialog', { name: zh['guide.sandbox.title'] })
    expect(within(stage).getByRole('heading', { name: zh['guide.sandbox.title'] })).toBeTruthy()
    expect(within(stage).getByText(t('detail.crumb', { index: '01', total: '09' }))).toBeTruthy()
    expect(within(stage).getByText(zh['guide.sandbox.description'])).toBeTruthy()
    for (const keyword of zh['guide.sandbox.chips'].split(' · ')) {
      expect(within(stage).getByText(keyword)).toBeTruthy()
    }
    expect(screen.getByTestId('guide-rays').children).toHaveLength(22)
  })

  it('browses the roster with next/prev while expanded', async () => {
    openGuide()
    fireEvent.click(screen.getByRole('article', { name: zh['guide.goals.title'] }))
    await frames()
    expect(within(screen.getByRole('dialog', { name: zh['guide.goals.title'] })).getByText(t('detail.crumb', { index: '05', total: '09' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(zh['action.next']) }))
    expect(within(screen.getByRole('dialog', { name: zh['guide.skills.title'] })).getByText(t('detail.crumb', { index: '06', total: '09' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(zh['action.prev']) }))
    expect(within(screen.getByRole('dialog', { name: zh['guide.goals.title'] })).getByText(zh['guide.goals.description'])).toBeTruthy()
  })

  it('folds the stage back with Esc, then closes the dialog with Esc', async () => {
    openGuide()
    fireEvent.click(screen.getByRole('article', { name: zh['guide.web.title'] }))
    await frames()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: zh['guide.web.title'] })).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(9)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('article')).toBeNull()
  })

  it('closes via the mask and reopens from the trigger', () => {
    openGuide()
    expect(screen.getAllByRole('article')).toHaveLength(9)
    fireEvent.click(screen.getByTestId('guide-mask'))
    expect(screen.queryByRole('article')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['section.title'] }))
    expect(screen.getAllByRole('article')).toHaveLength(9)
  })

  it('toggles demo playback from the media frame', async () => {
    openGuide()
    fireEvent.click(screen.getByRole('article', { name: zh['guide.skills.title'] }))
    await frames()
    const play = screen.getByRole('button', { name: zh['detail.play'] })
    expect(play.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(play)
    expect(play.getAttribute('aria-pressed')).toBe('false')
  })

  it('morphs the stage from the clicked card when surfaces are measurable', async () => {
    stubRects()
    openGuide()
    fireEvent.click(screen.getByRole('article', { name: zh['guide.workflows.title'] }))
    await frames()
    await wait(650)
    fireEvent.keyDown(document, { key: 'Escape' })
    await wait(650)
    expect(screen.queryByRole('dialog', { name: zh['guide.workflows.title'] })).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(9)
  })

  it('handles unmounting while the open morph timer is pending', async () => {
    stubRects()
    const { unmount } = render(<GuideHome wide t={t} />)
    fireEvent.click(screen.getByRole('button', { name: zh['section.title'] }))
    fireEvent.click(screen.getByRole('article', { name: zh['guide.shell.title'] }))
    await frames()
    unmount()
    await wait(650)
  })

  it('handles the dialog closing while the close morph timer is pending', async () => {
    stubRects()
    openGuide()
    fireEvent.click(screen.getByRole('article', { name: zh['guide.skills.title'] }))
    await frames()
    await wait(650)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: zh['section.title'] }))
    await wait(650)
    fireEvent.click(screen.getByRole('button', { name: zh['section.title'] }))
    expect(screen.getAllByRole('article')).toHaveLength(9)
  })

  it('navigates with the arrow keys and ignores them on the grid', async () => {
    openGuide()
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(screen.queryByRole('dialog', { name: zh['guide.skills.title'] })).toBeNull()
    fireEvent.keyDown(screen.getByRole('article', { name: zh['guide.goals.title'] }), { key: 'Enter' })
    await frames()
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(within(screen.getByRole('dialog', { name: zh['guide.skills.title'] })).getByText(t('detail.crumb', { index: '06', total: '09' }))).toBeTruthy()
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(within(screen.getByRole('dialog', { name: zh['guide.goals.title'] })).getByText(zh['guide.goals.title'])).toBeTruthy()
  })

  it('folds the stage, not the dialog, when the mask is hit while expanded', async () => {
    openGuide()
    fireEvent.click(screen.getByRole('article', { name: zh['guide.shell.title'] }))
    await frames()
    fireEvent.click(screen.getByTestId('guide-mask'))
    expect(screen.queryByRole('dialog', { name: zh['guide.shell.title'] })).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(9)
  })

  it('closes the whole dialog from the try-it action', async () => {
    openGuide()
    fireEvent.click(screen.getByRole('article', { name: zh['guide.plugins.title'] }))
    await frames()
    fireEvent.click(screen.getByRole('button', { name: zh['action.try'] }))
    expect(screen.queryByRole('article')).toBeNull()
  })

  it('ignores a second card while the first expand is in flight', async () => {
    openGuide()
    fireEvent.click(screen.getByRole('article', { name: zh['guide.sandbox.title'] }))
    fireEvent.click(screen.getByRole('article', { name: zh['guide.log.title'] }))
    await frames()
    expect(within(screen.getByRole('dialog', { name: zh['guide.sandbox.title'] })).getByText(t('detail.crumb', { index: '01', total: '09' }))).toBeTruthy()
  })

  it('accents a single-word trigger title without splitting it', () => {
    const t1 = (key: keyof typeof zh, params?: Record<string, string>): string =>
      key === 'section.title' ? 'Solo' : t(key, params)
    render(<GuideHome wide t={t1} />)
    fireEvent.click(screen.getByRole('button', { name: 'Solo' }))
    expect(screen.getByRole('heading', { name: 'Solo' })).toBeTruthy()
  })

  it('ignores key presses while an expand morph is in flight', async () => {
    openGuide()
    fireEvent.keyDown(screen.getByRole('article', { name: zh['guide.skills.title'] }), { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    fireEvent.keyDown(screen.getByRole('article', { name: zh['guide.web.title'] }), { key: 'Enter' })
    await frames()
    expect(within(screen.getByRole('dialog', { name: zh['guide.skills.title'] })).getByText(t('detail.crumb', { index: '06', total: '09' }))).toBeTruthy()
  })

  it('opens cards with Enter or Space and ignores other keys', async () => {
    openGuide()
    fireEvent.keyDown(screen.getByRole('article', { name: zh['guide.shell.title'] }), { key: ' ' })
    await frames()
    expect(screen.getByRole('dialog', { name: zh['guide.shell.title'] })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await frames()
    fireEvent.keyDown(screen.getByRole('article', { name: zh['guide.web.title'] }), { key: 'a' })
    expect(screen.queryByRole('dialog', { name: zh['guide.web.title'] })).toBeNull()
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
