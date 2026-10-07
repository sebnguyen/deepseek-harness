// Web e2e scenario: assistant IconActions belong to the settled answer, so
// they arrive with `turn/end` and not before. The recorded turn narrates in
// plain text before its tool call, which is the event order that would show the
// footer beside mid-turn narration for the seconds a tool runs and then move it
// down. A `hang` sidecar on the SECOND model call parks the turn after the
// narration and the tool result are durable, so the running state is stable by
// construction rather than by timing; stopping from that park writes the
// `turn/end` that hands the footer to the turn's transcript tail.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed } from 'vitest'
import type { ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/turn-tail-actions', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
// Three goldens for the same message: parked mid-turn, aborted, and completed.
const RUNNING_EXPECTED = join(SNAPSHOT_DIR, 'running.expected.md')
const SETTLED_EXPECTED = join(SNAPSHOT_DIR, 'settled.expected.md')
const USAGE_EXPANDED_EXPECTED = join(SNAPSHOT_DIR, 'usage-expanded.expected.md')
const COMPLETED_EXPECTED = join(SNAPSHOT_DIR, 'completed.expected.md')
const FOCUSED_EXPECTED = join(SNAPSHOT_DIR, 'focused.expected.md')
const MODE = webSnapshotMode()

// The recording must carry text in the SAME assistant message as the tool
// call; a Think-only step would leave nothing for the footer to attach to and
// the scenario would pass against either implementation.
const NARRATION = 'Reading the workspace now.'
const PROMPT = `Begin your reply with the plain sentence "${NARRATION}" as text, and in that same message call the bash tool with the command "echo alpha". After the tool result, reply with the single word DONE and stop.`

describe('web e2e: assistant IconActions wait for the turn to end', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let sessionEvents: SessionEvent[]
  let sidecarDir: string | undefined

  afterEach(async () => {
    // close() carries the fixture-consumption tripwire, so its failure is the
    // scenario's failure; run every teardown step, then rethrow what failed.
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    browser = undefined
    const closing = scaffold
    scaffold = undefined
    await closing?.close().catch((error: unknown) => failures.push(error))
    if (sidecarDir !== undefined) await rm(sidecarDir, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    sidecarDir = undefined
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'turn-tail-actions teardown failed')
  })

  /** Boot scaffold + page, materializing the sidecar before the replay row installs. */
  async function launch(
    buildOverride?: (sidecarHome: string) => ReplayOverrideDoc,
    // Throughput snapshots require a nonzero interval between replayed chunks.
    paceMs = 1,
  ): Promise<void> {
    sessionEvents = []
    let overridePath: string | undefined
    if (buildOverride !== undefined) {
      sidecarDir = await mkdtemp(join(tmpdir(), 'dsh-web-e2e-sidecar-'))
      overridePath = join(sidecarDir, 'replay.override.json')
      await writeFile(overridePath, JSON.stringify(buildOverride(sidecarDir)))
    }
    scaffold = await launchWebScaffold({
      replayFixture: FIXTURE,
      ...(overridePath === undefined ? {} : { replayOverride: overridePath }),
      compareReplaySession: overridePath === undefined,
      paceMs,
    })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }

  /** Send the recorded prompt with the settled barrier pre-armed (returned wrapped so the caller can act mid-turn). */
  async function sendPrompt(timeoutMs?: number): Promise<{ settled: ReturnType<WebScaffold['whenTurnSettled']> }> {
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold!.whenTurnSettled(timeoutMs)
    await input.fill(PROMPT)
    await input.press('Enter')
    return { settled }
  }

  it('matches the canonical persisted session', async () => {
    await launch()
    const { settled } = await sendPrompt(30_000)
    await settled
  })

  it('withholds the footer while the turn runs and grants it at turn/end', async () => {
    expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    let marker = ''
    // Patch the SECOND call: the first one delivers the narration and the tool
    // call as recorded, so the park happens with a durable mid-turn message.
    await launch((sidecarHome) => {
      marker = join(sidecarHome, '.hang-ready')
      return { patches: [{ at: 1, entry: { kind: 'hang', readyFile: marker } }] }
    })
    onTestFailed(() => saveFailureShot(page, 'web-e2e-turn-tail-actions'))
    // The barrier is armed before the park and awaited only after the stop
    // click, so its budget must cover the whole parked phase: marker poll,
    // live-state polls, and two captures with their stability windows. The
    // replay default (30s) leaves no headroom on a slow runner.
    const { settled } = await sendPrompt(120_000)
    // The marker IS the synchronization: the second call is provably parked,
    // so the first step's message and tool result are already durable.
    await expect.poll(() => existsSync(marker), { timeout: 20_000 }).toBe(true)
    // Both live spans fold while the parked turn stays open: step 1's run
    // behind its counts disclosure, and the parked model call behind the
    // working disclosure.
    expect(await page.locator('[data-turn-process]').count()).toBe(2)
    expect(await page.getByRole('button', { name: 'Bash Print alpha to stdout' }).isVisible()).toBe(false)
    await expect.poll(
      () => page.getByRole('status').filter({ hasText: 'Deep diving...' }).isVisible(),
      { timeout: 10_000 },
    ).toBe(true)
    await page.locator('[data-streaming="true"]')
      .getByText('partial', { exact: true })
      .waitFor({ timeout: 10_000 })
    // Only the user bubble owns a footer (clock + copy; user bubbles carry no
    // branch action): the narration is not the answer yet.
    const copyButtons = page.getByRole('button', { name: 'Copy' })
    await expect.poll(() => copyButtons.count(), { timeout: 10_000 }).toBe(1)
    expect(await page.getByRole('button', { name: 'Branch into a new conversation' }).count()).toBe(0)
    await copyButtons.first().focus()
    const running = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(RUNNING_EXPECTED, running, MODE)

    // Closing the turn from the park is the state change under test: an
    // aborted turn is durably closed, so its transcript tail (the frozen
    // partial) takes the seat while the mid-turn narration keeps none.
    await page.getByRole('button', { name: 'Stop generating' }).click()
    await settled
    expect(sessionEvents.filter(e => e.type === 'turn/end').map(e => e.data.reason.kind)).toEqual(['aborted'])
    await page.locator('[data-turn-process]').waitFor({ timeout: 10_000 })
    await expect.poll(() => copyButtons.count(), { timeout: 10_000 }).toBe(2)
    await expect.poll(() => page.locator('[data-streaming="true"]').count(), { timeout: 10_000 }).toBe(0)
    await copyButtons.last().focus()
    const settledAria = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(SETTLED_EXPECTED, settledAria, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it('shows exact completed-Turn usage and expands its available facts', async () => {
    await launch(undefined, 5)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-turn-usage-expanded'))
    const { settled } = await sendPrompt(120_000)
    await settled

    const trigger = page.getByRole('button', { name: /Usage 15\.8K tok/ })
    await expect.poll(() => trigger.count(), { timeout: 10_000 }).toBe(1)
    expect(await trigger.getAttribute('aria-expanded')).toBe('false')
    // The usage pill carries the icon and the turn total; the time pill beside
    // it carries the run time, and both keep their details dialog-only.
    expect(await trigger.textContent()).toBe('Usage 15.8K tok')
    const timeTrigger = page.getByRole('button', { name: /^Ran for \S+$/ })
    expect(await timeTrigger.count()).toBe(1)
    expect(await page.locator('[data-turn-tail]').getByText(/tok\/s|TTFT/).count()).toBe(0)
    expect(await page.getByRole('dialog').count()).toBe(0)

    await trigger.click()
    expect(await trigger.getAttribute('aria-expanded')).toBe('true')
    const dialog = page.getByRole('dialog', { name: 'Turn usage' })
    expect(await dialog.count()).toBe(1)
    expect(await dialog.getByText('deepseek-official/deepseek-v4-flash', { exact: true }).count()).toBe(1)
    expect(await dialog.getByText('49.7%', { exact: true }).count()).toBe(1)
    expect(await dialog.getByText('7,891 tok', { exact: true }).count()).toBe(1)
    expect(await dialog.getByText('7,808 tok', { exact: true }).count()).toBe(1)
    expect(await dialog.getByText('112 tok (42 tok reasoning)', { exact: true }).count()).toBe(1)
    expect(await dialog.getByText('15,811 tok', { exact: true }).count()).toBe(1)
    await page.keyboard.press('Escape')
    expect(await page.getByRole('dialog').count()).toBe(0)

    await timeTrigger.click()
    const timeDialog = page.getByRole('dialog', { name: 'Turn time and speed' })
    expect(await timeDialog.count()).toBe(1)
    expect(await timeDialog.getByText(/tok\/s/).count()).toBe(0)
    expect(await timeDialog.getByText('Time to first token (TTFT)', { exact: true }).count()).toBe(0)
    await page.keyboard.press('Escape')
    await trigger.click()

    const expanded = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(USAGE_EXPANDED_EXPECTED, expanded, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it('folds the Turn process after the completed reply becomes the answer', async () => {
    await launch(undefined, 5)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-turn-tail-actions-completed'))
    const { settled } = await sendPrompt()
    await settled
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 10_000 }).toBe(1)
    const process = page.locator('[data-turn-process]')
    await expect.poll(() => process.count(), { timeout: 10_000 }).toBe(1)
    expect(await process.getAttribute('aria-expanded')).toBe('false')
    // The disclosure rides the span opener row, and the collapsed tool row of
    // the process-only first Step stays out of sight.
    expect(await process.evaluate(element =>
      element.closest<HTMLElement>('[data-chat-flow-kind]')?.getAttribute('data-chat-flow-kind')))
      .toBe('assistant-step-start')
    expect(await page.getByRole('button', { name: 'Bash Print alpha to stdout' }).isVisible()).toBe(false)
    // The standing narration of the span is visible while the folded
    // tool row of the process-only first Step stays out of sight.
    expect(await page.getByText(NARRATION, { exact: true }).first().isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: 'Bash Print alpha to stdout' }).isVisible()).toBe(false)
    await process.focus()
    const completed = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(COMPLETED_EXPECTED, completed, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('expands the folded span and collapses it again', async () => {
    await launch()
    onTestFailed(() => saveFailureShot(page, 'web-e2e-span-expansion'))
    const { settled } = await sendPrompt()
    await settled
    const process = page.locator('[data-turn-process]')
    const tool = page.getByRole('button', { name: 'Bash Print alpha to stdout' })
    await process.waitFor({ timeout: 10_000 })
    expect(await process.getAttribute('aria-expanded')).toBe('false')
    expect(await tool.isVisible()).toBe(false)

    await process.click()
    expect(await process.getAttribute('aria-expanded')).toBe('true')
    await tool.waitFor({ state: 'visible', timeout: 10_000 })

    await process.click()
    // Collapse glides the row to its closed box first, so the row only
    // leaves once the glide hands it to hidden="until-found".
    await expect.poll(() => tool.isVisible(), { timeout: 10_000 }).toBe(false)
    expect(await process.getAttribute('aria-expanded')).toBe('false')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('lets settled span boundaries hold no column space', async () => {
    await launch()
    const { settled } = await sendPrompt()
    await settled
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 10_000 }).toBe(1)
    // Once every step settles, the boundary renderers decline their rows; the
    // column rhythm skips those seats instead of holding a blank gap for each,
    // so two standing messages of one multi-step turn stay one flow gap apart.
    await expect.poll(() => page.evaluate(() => {
      const column = [...document.querySelectorAll<HTMLElement>('[class*="column"]')].sort(
        (a, b) => b.querySelectorAll('[data-chat-flow-kind]').length
          - a.querySelectorAll('[data-chat-flow-kind]').length,
      )[0]
      const messages = [...(column?.querySelectorAll<HTMLElement>(
        '[data-chat-flow-kind="assistant-step-message"]',
      ) ?? [])]
      const [first, second] = messages
      if (first === undefined || second === undefined) return -1
      return Math.round(second.getBoundingClientRect().top - first.getBoundingClientRect().bottom)
    }), { timeout: 10_000 }).toBe(16)
  }, 60_000)

  it('keeps a focused process member open when the completed reply arrives', async () => {
    await launch(undefined, 200)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-turn-tail-actions-focused'))
    const { settled } = await sendPrompt()
    // The live span folds as its members arrive, so expanding it is what
    // puts the tool row on screen for the focus scenario.
    const process = page.locator('[data-turn-process]')
    await process.first().waitFor({ timeout: 30_000 })
    await process.first().click()
    const tool = page.getByRole('button', { name: 'Bash Print alpha to stdout' })
    await tool.waitFor({ timeout: 30_000 })
    await tool.focus()
    expect(await tool.evaluate(element => element.ownerDocument.activeElement === element)).toBe(true)
    await settled
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 10_000 }).toBe(1)
    await expect.poll(() => process.count(), { timeout: 10_000 }).toBe(1)
    expect(await process.getAttribute('aria-expanded')).toBe('true')
    expect(await tool.evaluate(element => element.ownerDocument.activeElement === element)).toBe(true)
    const focused = await captureStableAria(page, '[class*="centerCol"]', scaffold!.workspaceCwd)
    await compareOrRefreshGolden(FOCUSED_EXPECTED, focused, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps a closed fixture inventory', async () => {
    await assertFixtureInventory(
      SNAPSHOT_DIR,
      [
        'completed.expected.md', 'focused.expected.md', 'running.expected.md', 'session.v3.jsonl',
        'settled.expected.md', 'usage-expanded.expected.md',
      ],
    )
  })
})
