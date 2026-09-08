/** Keyless real-browser coverage of the SuperGoal banner, question, and controls. */
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('./expected/super-goal/session.jsonl', import.meta.url))
const OVERRIDE = fileURLToPath(new URL('./expected/super-goal/replay.override.json', import.meta.url))
const EXPECTED = fileURLToPath(new URL('./expected/super-goal/blocked.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const OBJECTIVE = 'Deploy the verified product to the selected environment'

describe('web e2e: SuperGoal session banner', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, replayOverride: OVERRIDE, paceMs: 100 })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows the objective above the transcript, requests input, then pauses and clears', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-super-goal'))
    const input = page.locator('[data-composer-input][contenteditable="true"]').first()
    await input.fill('/supergoal ' + OBJECTIVE)
    await input.press('Enter')
    const banner = page.getByRole('region', { name: 'SuperGoal', exact: true })
    await banner.waitFor({ timeout: 15_000 })
    expect(await banner.getByText(OBJECTIVE, { exact: true }).count()).toBe(1)
    const composer = page.locator('[data-question-key]')
    await composer.waitFor({ timeout: 15_000 })
    await expect.poll(() => banner.getByRole('status').textContent()).toContain('Needs your input')
    expect(await composer.getByRole('radio', { name: 'Use staging', exact: true }).count()).toBe(1)
    expect(await page.locator('[data-state="warning"]').count()).toBeGreaterThan(0)
    const bounds = await banner.boundingBox()
    const questionBounds = await composer.boundingBox()
    expect(bounds).not.toBeNull()
    expect(questionBounds).not.toBeNull()
    expect(bounds!.y + bounds!.height).toBeLessThan(questionBounds!.y)
    const objectiveSize = await banner.getByText(OBJECTIVE, { exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    const statusSize = await banner.getByRole('status').evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    expect(statusSize).toBeLessThan(objectiveSize)
    const accentWidth = await banner.evaluate(el => parseFloat(getComputedStyle(el).borderInlineStartWidth))
    expect(accentWidth).toBeGreaterThan(1)
    await compareOrRefreshGolden(EXPECTED, await captureStableAria(page, 'section[aria-label="SuperGoal"]', scaffold.workspaceCwd), MODE)
    await composer.getByRole('radio', { name: 'Use staging', exact: true }).click()
    await composer.getByRole('radio', { name: 'Use staging', exact: true }).press('Enter')
    await expect.poll(() => banner.getByRole('status').textContent()).toContain('Not yet achieved')
    await input.waitFor({ timeout: 10_000 })
    await input.fill('/supergoal pause')
    await input.press('Enter')
    await expect.poll(() => banner.getByRole('status').textContent()).toContain('Paused')
    await input.fill('/supergoal clear')
    await input.press('Enter')
    await expect.poll(() => banner.count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
