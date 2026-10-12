// Web e2e scenario: every session-selection gesture returns keyboard focus
// to the composer.
//
// The InputBar's own mount effect covers session SWITCHES (the subtree
// remounts per current Session), but reselecting the already-current row
// changes no store value — the session list dedups, no effect ever fires,
// and keyboard focus stays wherever the user left it. ui-workspace therefore
// emits every openSession gesture on a monotonic channel
// (UiWorkspace.sessionActivations) and ui-conversation refocuses the composer
// on it; this scenario pins both sides with real clicks.
//
// Zero model calls: a fresh workspace's blank session carries a live composer
// and the scenario only clicks existing chrome.
import type { Page } from 'playwright'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

/** The live composer surface (a fresh blank session's, enabled). */
function composer(page: Page): ReturnType<Page['locator']> {
  return page.locator('[data-composer-input][contenteditable="true"]').first()
}

/** True while the live composer holds keyboard focus. */
async function composerFocused(page: Page): Promise<boolean> {
  return await composer(page).evaluate(element => element === document.activeElement)
}

it('refocuses the composer on session-selection gestures, reselect included', async () => {
  const scaffold = await launchWebScaffold({})
  try {
    // Same local escape hatch as chat-scroll-contract: runners without the
    // bundled browser's shared libs point at their system chromium instead.
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    let failurePage: Page | undefined
    try {
      const page = await newEnglishPage(browser)
      failurePage = page
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl)
      await connectFreshWorkspace(page, scaffold.workspaceCwd, 'composer-focus-session-select')
      await expect.poll(() => composerFocused(page)).toBe(true)

      // Blur outside any focusable chrome; a later refocus must be earned by
      // the selection gesture, not by the initial mount.
      const blur = async () => {
        await composer(page).evaluate((element) => { element.blur() })
        await expect.poll(() => composerFocused(page)).toBe(false)
      }
      // Reselecting the CURRENT session's row changes no store value; the
      // gesture alone must return focus to the composer.
      await blur()
      await page.locator('[role="treeitem"][aria-selected="true"]').first().click()
      await expect.poll(() => composerFocused(page)).toBe(true)

      // The shell's New Session action rides the same gesture channel.
      await blur()
      // Two wide-rail buttons carry the 'New session' aria label (the brand
      // doubles as the shortcut); the labeled control is the test's target.
      await page.getByRole('button', { name: 'New session', exact: true })
        .filter({ hasText: 'New Session' }).click()
      await expect.poll(() => composerFocused(page)).toBe(true)

      expect(tripwire.pageErrors).toEqual([])
    } catch (error) {
      if (failurePage !== undefined) await saveFailureShot(failurePage, 'web-e2e-composer-focus-session-select')
      throw error
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})
