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
let tripwire: ReturnType<typeof watchConsole>

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Browser control local fixture</title><h1>Browser frame received</h1>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Fixture needs a TCP address')
  destination = `http://127.0.0.1:${address.port}/`
  overlayRoot = await mkdtemp(join(tmpdir(), 'dsh-browser-overlay-'))
  const overlay = join(overlayRoot, 'cordis.patch.yml')
  const providerUrl = new URL('../../../Custom Plugins/browser-control/index.js', import.meta.url).href
  await writeFile(overlay, (await readFile(bundle, 'utf8')).replace('name: dsh-browser-control', `name: ${JSON.stringify(providerUrl)}`))
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

it('starts, navigates, displays a real frame, stops, and reopens the same session browser', async () => {
  onTestFailed(() => saveFailureShot(page, 'web-e2e-browser-control'))
  await expect.poll(() => scaffold.ctx.sessions.get(sessionId) !== undefined, { timeout: 15_000 }).toBe(true)
  await page.locator('button[aria-label="Start Browser"]').click()
  const panel = page.getByRole('region', { name: 'Browser', exact: true })
  await panel.getByRole('button', { name: 'Stop browser', exact: true }).waitFor({ timeout: 20_000 })
  await panel.getByPlaceholder('Enter URL (optional)').fill(destination)
  await panel.getByRole('button', { name: 'Navigate', exact: true }).click()
  const frame = panel.getByRole('img', { name: 'Browser control local fixture', exact: true })
  await frame.waitFor({ timeout: 20_000 })
  await expect.poll(() => frame.evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true)
  expect(scaffold.ctx.browserControl.snapshot(sessionId)).toMatchObject({ open: true, url: destination, title: 'Browser control local fixture' })
  expect(await frame.getAttribute('src')).toMatch(/^data:image\/jpeg;base64,/)
  await panel.getByRole('button', { name: 'Stop browser', exact: true }).click()
  await panel.getByText('Stopped', { exact: true }).waitFor()
  expect(scaffold.ctx.browserControl.snapshot(sessionId).open).toBe(false)
  await panel.getByPlaceholder('Enter URL (optional)').fill(destination)
  await panel.getByRole('button', { name: 'Start Browser', exact: true }).click()
  await frame.waitFor({ timeout: 20_000 })
  expect(scaffold.ctx.browserControl.snapshot(sessionId).open).toBe(true)
  expect(tripwire.pageErrors).toEqual([])
})
