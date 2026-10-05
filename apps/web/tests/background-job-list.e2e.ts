// Input-dock background activity driven by a real `ctx.jobs` entry. No model
// call is involved. The scenario asserts the chip, the drawer tree, the job's
// terminal detail, and the registry-driven settlement into the archive; all
// locators are aria roles and test ids owned by dsh-client-ui-activity, so the
// scenario carries no golden.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url))
const SEED_ID = 'background-job-list-web-e2e'
// Long enough that the running assertions never race the process exiting on
// their own; the test kills it explicitly to reach the settled state.
// The leading echo gives the drawer's output tail a line to stream while
// the job is still running; the sleep holds the slot open for the asserts.
const COMMAND = 'echo background-stream-ok; sleep 45'

/**
 * Wait for opening a session to publish its live Agent.
 * @param scaffold - the booted web scaffold.
 * @param sessionId - the opened session's identity.
 * @returns the registered Agent instance.
 */
async function liveAgent(scaffold: WebScaffold, sessionId: SessionId): Promise<Agent> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const found = scaffold.ctx.agents.get(sessionId)
    if (found !== undefined) return found
    if (Date.now() > deadline) throw new Error(`opening session "${sessionId}" published no live Agent`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

describe('web e2e: background activity drawer', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let agent: Agent
  let jobId: JobId

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()

    // Opening the session drives the Host's ordinary Agent resolution; the
    // job owner must be that exact live instance, never a second one.
    // `expect.poll` is test-scoped, so this hook polls by hand.
    agent = await liveAgent(scaffold, SessionId(SEED_ID))
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows a running background job in the input dock without a refresh', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-background-job-running'))
    // Polling for zero would pass at t=0 before delivery and prove nothing.
    const chip = page.getByRole('button', { name: '1 background activity running' })
    expect(await chip.count()).toBe(0)

    // Geometry of the drawer: closed it must occupy no height at all (a
    // closed drawer may not take space above the composer), and open it
    // expands to exactly its fixed pane — min(60vh, 640px) is 600px at
    // this lane's 1000px viewport.
    const wrapHeight = (): Promise<number> => page
      .locator('[role="region"][aria-label="Background activity"]')
      .evaluate(element => element.parentElement!.getBoundingClientRect().height)

    const started = await scaffold.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('background-job-list-e2e'),
      name: 'bash',
      arguments: { command: COMMAND, description: 'Hold a background slot open', run_in_background: true },
      agent,
    })
    const reported = started.content.map(block => block.type === 'text' ? block.text : '').join('')
    const matched = /\bbash-\d+\b/.exec(reported)
    if (matched === null) throw new Error(`background bash reported no job id: ${reported}`)
    jobId = JobId(matched[0])

    await chip.waitFor({ timeout: 15_000 })
    await expect.poll(wrapHeight, { timeout: 5_000 }).toBe(0)

    await chip.click()
    const drawer = page.getByRole('region', { name: 'Background activity' })
    await drawer.waitFor({ timeout: 10_000 })
    await expect.poll(wrapHeight, { timeout: 5_000 }).toBe(600)
    const row = drawer.getByRole('list', { name: 'Live activity' }).getByRole('listitem').first()
    await row.waitFor({ timeout: 10_000 })
    await expect.poll(() => row.textContent()).toContain(COMMAND)

    // Selecting the live row shows its running status in the detail pane,
    // and Escape closes the drawer and returns focus to the chip.
    // The row status repeats the status word, so the detail assertion must
    // stay scoped to the detail pane to remain a single match.
    await row.getByRole('button').click()
    await drawer.getByLabel('Activity detail').getByText('running', { exact: true }).waitFor({ timeout: 10_000 })

    // The jobOutput mirror reaches the pane live while the job runs.
    await expect.poll(
      () => drawer.getByLabel('Job output').textContent() ?? '',
      { timeout: 10_000 },
    ).toContain('background-stream-ok')

    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'hidden', timeout: 10_000 })
    await expect.poll(wrapHeight, { timeout: 5_000 }).toBe(0)


    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('settles the killed job into the archive with its outcome legible', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-background-job-settled'))
    expect(scaffold.ctx.jobs.kill(jobId, agent, 'web e2e cancellation')).toBe('requested')

    const idle = page.getByRole('button', { name: '1 background activity', exact: true })
    await idle.waitFor({ timeout: 20_000 })
    await idle.click()

    const drawer = page.getByRole('region', { name: 'Background activity' })
    await drawer.waitFor({ timeout: 10_000 })
    const archive = drawer.getByRole('button', { name: 'Archive (1)' })
    await archive.waitFor({ timeout: 10_000 })
    await archive.click()
    const row = drawer.getByRole('list', { name: 'Archived activity' }).getByRole('listitem').first()
    await row.waitFor({ timeout: 10_000 })
    await expect.poll(() => row.textContent()).toContain(COMMAND)

    // The settled row's outcome stays legible in the pane's detail line;
    // scoped to the detail pane because the row repeats the status word.
    // Selection is a toggle that survives across tests, so re-click when
    // the first press flips an already-selected row off.
    const rowButton = row.getByRole('button')
    await rowButton.click()
    if (await rowButton.getAttribute('aria-pressed') !== 'true') await rowButton.click()
    await drawer.getByLabel('Activity detail').getByText('cancelled', { exact: true }).waitFor({ timeout: 10_000 })

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
