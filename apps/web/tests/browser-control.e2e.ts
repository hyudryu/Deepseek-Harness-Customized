/** Real optional browser provider, Remote stream, and built Web controls without model calls. */
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-browser-controller'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const bundle = fileURLToPath(new URL('../../../Custom Plugins/browser-control/cordis.patch.yml', import.meta.url))
const manifest = fileURLToPath(new URL('../../../Custom Plugins/browser-control/package.json', import.meta.url))
const seed = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const sessionId = SessionId('browser-control-web-e2e')
let scaffold: WebScaffold
let browser: Browser
let page: Page
let server: Server
let overlayRoot: string | undefined
let destination: string
let homepage: string
let tripwire: ReturnType<typeof watchConsole>

beforeAll(async () => {
  server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    const title = request.url === '/home' ? 'Browser homepage local fixture' : 'Browser control local fixture'
    response.end(`<!doctype html><title>${title}</title><h1>Browser frame received</h1>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Fixture needs a TCP address')
  destination = `http://localhost:${address.port}/`
  homepage = `http://127.0.0.1:${address.port}/home`
  overlayRoot = await mkdtemp(join(tmpdir(), 'dsh-browser-overlay-'))
  const overlay = join(overlayRoot, 'cordis.patch.yml')
  const providerUrl = new URL('../../../Custom Plugins/browser-control/index.js', import.meta.url).href
  const patch = (await readFile(bundle, 'utf8'))
    .replace('name: dsh-browser-control', `name: ${JSON.stringify(providerUrl)}`)
    .replace(/^        (?:backend|homepage):.*\r?\n/gm, '')
    .replace('        headless:', `        backend: playwright\n        homepage: ${JSON.stringify(homepage)}\n        headless:`)
  await writeFile(overlay, patch)
  scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [manifest] })
  await seedSession(scaffold, await readFile(seed, 'utf8'), sessionId)
  browser = await chromium.launch()
  page = await newEnglishPage(browser)
  tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  const group = page.getByRole('treeitem').first()
  await group.waitFor({ timeout: 30_000 })
  await group.click()
  await page.getByRole('treeitem').nth(1).click()
}, 120_000)

afterAll(async () => {
  const outcomes = await Promise.allSettled([
    browser?.close(),
    scaffold?.close(),
    overlayRoot === undefined ? undefined : rm(overlayRoot, { recursive: true, force: true }),
    new Promise<void>((resolve, reject) => {
      if (server === undefined || !server.listening) { resolve(); return }
      server.closeAllConnections()
      server.close((error) => { if (error !== undefined) reject(error); else resolve() })
    }),
  ])
  const failures = outcomes.flatMap<unknown>(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : [])
  if (failures.length > 0) throw new AggregateError(failures, 'Browser smoke cleanup failed')
})

it('starts at its configured homepage, navigates a bare localhost URL, and reopens the session browser', async () => {
  onTestFailed(() => saveFailureShot(page, 'web-e2e-browser-control'))
  await expect.poll(() => scaffold.ctx.sessions.get(sessionId) !== undefined, { timeout: 15_000 }).toBe(true)
  await page.locator('button[aria-label="Start Browser"]').click()
  const panel = page.getByRole('region', { name: 'Browser', exact: true })
  await panel.getByRole('button', { name: 'Stop browser', exact: true }).waitFor({ timeout: 20_000 })
  const homeFrame = panel.getByRole('img', { name: 'Browser homepage local fixture', exact: true })
  await homeFrame.waitFor({ timeout: 20_000 })
  expect(scaffold.ctx.browserControl.snapshot(sessionId)).toMatchObject({ open: true, url: homepage })
  await panel.getByPlaceholder('Enter URL (optional)').fill(destination.replace('http://', ''))
  await panel.getByRole('button', { name: 'Navigate', exact: true }).click()
  const frame = panel.getByRole('img', { name: 'Browser control local fixture', exact: true })
  await frame.waitFor({ timeout: 20_000 })
  await expect.poll(() => frame.evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true)
  expect(scaffold.ctx.browserControl.snapshot(sessionId)).toMatchObject({ open: true, url: destination, title: 'Browser control local fixture' })
  expect(await frame.getAttribute('src')).toMatch(/^data:image\/jpeg;base64,/)
  const firstTabId = scaffold.ctx.browserControl.snapshot(sessionId).activeTabId
  await panel.getByRole('button', { name: 'New tab', exact: true }).click()
  await expect.poll(() => scaffold.ctx.browserControl.snapshot(sessionId).tabs?.length).toBe(2)
  await panel.getByRole('tab', { name: 'Browser homepage local fixture', exact: true }).waitFor()
  expect(scaffold.ctx.browserControl.snapshot(sessionId).activeTabId).not.toBe(firstTabId)
  await panel.getByRole('tab', { name: 'Browser control local fixture', exact: true }).click()
  await expect.poll(() => scaffold.ctx.browserControl.snapshot(sessionId).activeTabId).toBe(firstTabId)
  await frame.waitFor()
  expect(await panel.getByRole('textbox', { name: 'Address', exact: true }).inputValue()).toBe(destination)
  await panel.getByRole('button', { name: 'Close tab Browser homepage local fixture', exact: true }).click()
  await expect.poll(() => scaffold.ctx.browserControl.snapshot(sessionId).tabs?.length).toBe(1)
  expect(scaffold.ctx.browserControl.snapshot(sessionId).activeTabId).toBe(firstTabId)
  await panel.getByRole('button', { name: 'Stop browser', exact: true }).click()
  await panel.getByText('Stopped', { exact: true }).waitFor()
  expect(scaffold.ctx.browserControl.snapshot(sessionId).open).toBe(false)
  await panel.getByPlaceholder('Enter URL (optional)').fill(destination)
  await panel.getByRole('button', { name: 'Start Browser', exact: true }).click()
  await frame.waitFor({ timeout: 20_000 })
  expect(scaffold.ctx.browserControl.snapshot(sessionId).open).toBe(true)
  await panel.getByRole('button', { name: 'Close tab Browser control local fixture', exact: true }).click()
  await panel.getByText('Stopped', { exact: true }).waitFor()
  expect(scaffold.ctx.browserControl.snapshot(sessionId).open).toBe(false)
  expect(tripwire.pageErrors).toEqual([])
})
