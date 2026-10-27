// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BootPage } from '../src/boot-page.ts'

const pages: BootPage[] = []

/** First two boot tips, kept local so a copy change is deliberate. */
const FIRST_TIP = 'Tip: App Platform can redeploy on every push to your branch.'
const SECOND_TIP = 'Droplets are just waves with an IP address.'

afterEach(() => {
  for (const page of pages) page.dispose()
  pages.length = 0
  vi.useRealTimers()
  document.body.innerHTML = ''
})

function mount() {
  const el = document.createElement('div')
  document.body.append(el)
  const page = new BootPage(el)
  pages.push(page)
  return { el, page }
}

describe('BootPage', () => {
  it('draws the flat sweep page and the first DigitalOcean tip', () => {
    const { el } = mount()
    expect(el.firstElementChild?.getAttribute('data-dsh-boot')).toBe('')
    expect(el.textContent).toContain('DigitalOcean Harness')
    const spinner = el.querySelector<HTMLElement>('[data-dsh-boot-spinner]')
    expect(spinner?.nextElementSibling?.textContent).toContain('DigitalOcean Harness')
    expect(spinner?.querySelectorAll('rect').length).toBeGreaterThan(100)
    const tips = el.querySelector<HTMLElement>('[data-dsh-boot-tips]')
    expect(tips?.getAttribute('aria-label')).toBe('Loading plugins…')
    expect(tips?.querySelector('[data-surf-line="in"]')?.textContent).toBe(FIRST_TIP)
  })

  it('rotates the tips on the surf-up clock', () => {
    vi.useFakeTimers()
    const { el } = mount()
    expect(el.querySelector('[data-surf-line="in"]')?.textContent).toBe(FIRST_TIP)
    vi.advanceTimersByTime(3200)
    expect(el.querySelector('[data-surf-line="in"]')?.textContent).toBe(SECOND_TIP)
    expect(el.querySelector('[data-surf-line="out"]')?.textContent).toBe(FIRST_TIP)
  })

  it('keeps the sweep and tips while entries are active or loading', () => {
    const { el, page } = mount()
    page.setTotal(2)
    page.setState('a', 'active')
    page.setState('b', 'loading')
    expect(el.querySelector('[data-dsh-boot-spinner] svg')).toBeTruthy()
    expect(el.querySelector('[data-dsh-boot-tips]')).toBeTruthy()
    page.setState('b', 'active')
    expect(el.textContent).not.toContain('Failed to load plugins')
  })

  it('lists failed entries and stops the tips', () => {
    const { el, page } = mount()
    page.setState('@deepseek-ai/dsh-client-ui-layout', 'failed')
    page.setState('ok', 'active')
    page.setState('@deepseek-ai/dsh-client-ui-tool', 'failed')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-layout')
    expect(el.textContent).toContain('@deepseek-ai/dsh-client-ui-tool')
    expect(el.textContent).not.toContain('ok')
    expect(el.querySelector('[data-dsh-boot-tips]')).toBeNull()
  })

  it('shows the complete sweep report without the tips', () => {
    const { el, page } = mount()
    const report = 'web boot: 1 entry did not activate\nx: pending (waiting for service: y)'
    page.fail(report)
    page.setState('a', 'active')
    expect(el.textContent).toContain(report)
    expect(el.querySelector('[data-dsh-boot-tips]')).toBeNull()
  })

  it('detaches on disposal', () => {
    const { el, page } = mount()
    page.dispose()
    expect(el.childNodes).toHaveLength(0)
  })
})
