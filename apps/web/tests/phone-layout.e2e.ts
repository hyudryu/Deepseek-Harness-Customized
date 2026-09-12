// Web e2e scenario: the phone layout's three guarantees in the assembled
// application, at an iPhone-sized viewport. iOS zooms the page when a focused
// form control renders below 16px (the zoomed layout viewport then no longer
// fits the screen), paints the area outside the layout viewport from the root
// element's background, and at these widths the details and browser columns
// cover the conversation instead of sharing the row.
//
// Zero model calls: the empty hero already carries the composer and the
// sidebar's search control, so the scenario needs no session content.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

/** The user's content font size this scenario forces below the floor (the stylesheet fallback). */
const COMPACT_CONTENT_FONT = '14px'

/** Every editing surface's computed font size at the current viewport. */
async function editingFontSizes(page: Page): Promise<string[]> {
  return await page.evaluate((compact) => {
    document.body.style.setProperty('--dsh-content-font-size', compact)
    return [...document.querySelectorAll('input, select, textarea, [contenteditable="true"]')]
      .map(element => getComputedStyle(element).fontSize)
  }, COMPACT_CONTENT_FONT)
}

describe('web e2e: the phone layout', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('floors every editing surface at 16px on a phone and leaves wider frames alone', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-phone-layout-floor'))
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(async () => (await editingFontSizes(page)).length, { timeout: 15_000 }).toBeGreaterThan(0)
    const phone = await editingFontSizes(page)
    expect(phone.every(size => Number.parseFloat(size) >= 16)).toBe(true)

    // The floor is the phone layout's: a wide frame keeps the user's size.
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect.poll(
      async () => (await editingFontSizes(page)).some(size => Number.parseFloat(size) < 16),
      { timeout: 15_000 },
    ).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the canvas in palette and the browser column closed at phone width', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-phone-layout-canvas'))
    await page.setViewportSize({ width: 390, height: 844 })
    const frame = page.locator('[class*="frame"]').first()
    await expect.poll(async () => await frame.getAttribute('data-browser-collapsed'), { timeout: 15_000 }).toBe('true')

    const shell = await page.evaluate(() => ({
      root: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      browserWidth: document.querySelector<HTMLElement>('[class*="browserCol"]')?.getBoundingClientRect().width ?? -1,
    }))
    // The root element carries the palette, so the strips iOS paints outside the
    // layout viewport are not left light; the browser column stays out of the way.
    expect(shell.root).toBe(shell.body)
    expect(shell.root).not.toBe('rgba(0, 0, 0, 0)')
    expect(shell.browserWidth).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
