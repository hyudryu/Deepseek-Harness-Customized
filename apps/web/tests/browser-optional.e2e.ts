/** Optional browser bundle boots its provider and controls together through the real Loader. */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

it('loads the optional browser bundle and shows its controls for a selected session', async () => {
  const bundle = new URL('../../../Custom Plugins/browser-control/', import.meta.url)
  const installation = await mkdtemp(join(tmpdir(), 'dsh-browser-install-'))
  onTestFinished(() => rm(installation, { recursive: true, force: true }))
  await mkdir(join(installation, 'node_modules'))
  await symlink(fileURLToPath(bundle), join(installation, 'node_modules/dsh-browser-control'), 'junction')
  await writeFile(join(installation, 'package.json'), JSON.stringify({
    name: 'browser-test-installation', dependencies: { 'dsh-browser-control': '0.1.0' },
  }))
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('cordis.patch.yml', bundle)),
    extraInstallAnchors: [join(installation, 'package.json')],
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ locale: 'en-US' })
    const consoleState = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.locator('button[aria-label="Start Browser"][aria-expanded]').waitFor({ timeout: 30_000 })
    expect(scaffold.ctx.get('browserControl')).toBeDefined()
    expect(scaffold.ctx.get('browserController')).toBeDefined()
    expect(await page.getByText('Failed to load plugins', { exact: true }).count()).toBe(0)
    expect(consoleState.pageErrors).toEqual([])
  } finally {
    await browser.close()

  }
}, 120_000)
