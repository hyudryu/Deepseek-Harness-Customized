/** Built Web composition: phone pairing controls and real QR account administration. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, writeComposerDraft } from './support.ts'

let scaffold: WebScaffold
let browser: Browser
let page: Page
let tripwire: ReturnType<typeof watchConsole>

beforeAll(async () => {
  scaffold = await launchWebScaffold({})
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
  tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await scaffold?.close()
})

it('boots both shipped client artifacts and imports/deletes an account through a phone-width Settings page', async () => {
  const mobile = page.getByRole('button', { name: 'Mobile access', exact: true })
  await mobile.waitFor({ state: 'visible', timeout: 30_000 })
  expect(await page.getByText('Failed to load plugins', { exact: true }).count()).toBe(0)
  const settings = page.getByRole('button', { name: 'Settings', exact: true })
  const settingsBox = await settings.boundingBox()
  const mobileBox = await mobile.boundingBox()
  expect(settingsBox).not.toBeNull()
  expect(mobileBox!.x).toBeGreaterThan(settingsBox!.x + settingsBox!.width / 2)
  await mobile.click()
  const pairing = page.getByRole('dialog', { name: 'Mobile access', exact: true })
  const toggle = pairing.getByRole('switch', { name: 'Allow mobile access' })
  await toggle.waitFor()
  expect(await toggle.isChecked()).toBe(false)
  const mobileStatus = await scaffold.hostFetch('/mobile-access')
  expect(mobileStatus.status).toBe(200)
  expect(await mobileStatus.json()).toEqual({ enabled: false, url: null })
  // CI has no Tailscale interface. Only the listener mutation is substituted;
  // the built QR encoder and rendered pairing image execute in Chromium.
  const pairingUrl = 'http://100.64.0.1:3080/?token=fixture-mobile'
  await page.route('**/mobile-access', async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    const body: unknown = route.request().postDataJSON()
    if (typeof body !== 'object' || body === null || !('enabled' in body) || typeof body.enabled !== 'boolean') {
      throw new Error('Expected boolean listener mutation')
    }
    await route.fulfill({ json: { enabled: body.enabled, url: body.enabled ? pairingUrl : null } })
  })
  await toggle.click()
  await expect.poll(() => toggle.isChecked()).toBe(true)
  const qr = pairing.getByRole('img', { name: 'Scan to open Harness on your phone' })
  await qr.waitFor()
  expect(await qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
  expect(await qr.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(256)
  expect(await pairing.getByRole('link', { name: 'Open mobile link' }).getAttribute('href')).toBe(pairingUrl)
  await toggle.click()
  await expect.poll(() => toggle.isChecked()).toBe(false)
  await qr.waitFor({ state: 'detached' })
  await page.unroute('**/mobile-access')
  await pairing.getByRole('button', { name: 'Close mobile access' }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).click()
  await settings.click()
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await dialog.getByRole('button', { name: 'Plugins', exact: true }).click()
  const configuration = dialog.getByRole('tab', { name: 'Plugin configuration', exact: true })
  await configuration.click()
  await dialog.getByRole('button', { name: /Authenticator MCP/ }).click()
  await dialog.getByText('No authenticator accounts saved.', { exact: true }).waitFor()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  // The fixture is a real PNG generated with qrcode from a public test-only TOTP key.
  const image = fileURLToPath(new URL('./fixtures/authenticator/account.png', import.meta.url))
  await dialog.getByLabel('Import QR code', { exact: true }).setInputFiles(image)
  await dialog.getByText('Authenticator account added.', { exact: true }).waitFor()
  const code = dialog.getByLabel('browser-smoke', { exact: true })
  await code.waitFor()
  expect(await code.textContent()).toMatch(/^\d{6}$/)
  const accounts = await scaffold.hostFetch('/authenticator')
  expect(accounts.status).toBe(200)
  expect(await accounts.json()).toMatchObject({ accounts: [{ label: 'browser-smoke', issuer: 'Fixture' }] })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: join(tmpdir(), 'dsh-mobile-authenticator-phone.png') })

  await dialog.getByRole('button', { name: 'Delete browser-smoke', exact: true }).click()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await dialog.getByText('Authenticator account deleted.', { exact: true }).waitFor()
  await dialog.getByText('No authenticator accounts saved.', { exact: true }).waitFor()
  expect(await (await scaffold.hostFetch('/authenticator')).json()).toEqual({ accounts: [] })
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const composer = page.locator('[data-composer-input][contenteditable="true"]')
  await expect.poll(async () => {
    const bounds = await composer.boundingBox()
    return bounds !== null && bounds.x >= 0 && bounds.x + bounds.width <= 390
  }).toBe(true)
  expect(await composer.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16)
  await writeComposerDraft(page, composer, 'Mobile composer draft')
  expect(await composer.textContent()).toBe('Mobile composer draft')
  await page.screenshot({ path: join(tmpdir(), 'dsh-mobile-composer-phone.png') })
  expect(tripwire.pageErrors).toEqual([])
})
