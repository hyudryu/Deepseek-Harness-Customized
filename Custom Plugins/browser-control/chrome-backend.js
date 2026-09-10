/** Chrome debugging-port connection and session-owned tabs in its persistent default context. */
import { EventEmitter } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { launch } from 'chrome-launcher'
import { chromium } from 'playwright'

const launches = new Map()

async function endpointAvailable(endpoint, timeout) {
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(timeout) })
    if (!response.ok) throw new Error(`Chrome debugging endpoint returned HTTP ${response.status}`)
    return true
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return false
    throw error
  }
}

/**
 * Flags for the launched persistent-profile Chrome.
 * @param config - normalized provider configuration.
 * @returns the flag list; hidden Chrome runs the new headless mode at a fixed page size.
 */
export function chromeLaunchFlags(config) {
  return [
    ...(config.chromeHeadless ? ['--headless=new', '--window-size=1280,800'] : []),
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
  ]
}

/**
 * Connect to local Chrome, launching it with the dedicated persistent profile
 * only when its debugging port is unavailable. The launched process is hidden
 * unless `chromeHeadless` is false: the panel mirrors and drives that browser,
 * so a taskbar window would be a second, redundant surface.
 */
export async function connectChrome(config) {
  let pending = launches.get(config.chromeEndpoint)
  if (!pending) {
    pending = (async () => {
      if (await endpointAvailable(config.chromeEndpoint, config.chromeConnectTimeoutMs)) return
      await mkdir(config.chromeUserDataDir, { recursive: true })
      const launched = await launch({
        port: Number(new URL(config.chromeEndpoint).port),
        userDataDir: config.chromeUserDataDir,
        ...(config.chromeExecutablePath ? { chromePath: config.chromeExecutablePath } : {}),
        startingUrl: 'about:blank',
        handleSIGINT: false,
        ignoreDefaultFlags: true,
        chromeFlags: chromeLaunchFlags(config),
      })
      launched.process.unref()
    })().finally(() => { launches.delete(config.chromeEndpoint) })
    launches.set(config.chromeEndpoint, pending)
  }
  await pending
  return chromium.connectOverCDP(config.chromeEndpoint, { timeout: config.chromeConnectTimeoutMs, noDefaults: true })
}

/** A context-like owner for new tabs; existing user tabs and shared context settings are untouched. */
export function chromeSessionContext(browser, config) {
  const shared = browser.contexts()[0]
  if (!shared) throw new Error('Chrome debugging endpoint has no persistent browser context')
  const events = new EventEmitter()
  const pages = new Set()
  let closing = false
  const attach = page => {
    if (pages.has(page)) return
    pages.add(page)
    page.setDefaultTimeout(config.defaultTimeoutMs)
    page.setDefaultNavigationTimeout(config.navigationTimeoutMs)
    page.on('popup', attach)
    page.on('close', () => {
      pages.delete(page)
      if (pages.size === 0 && !closing) events.emit('close')
    })
    events.emit('page', page)
  }
  return Object.assign(events, {
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    pages: () => [...pages],
    async newPage() {
      const page = await shared.newPage()
      attach(page)
      await page.bringToFront()
      return page
    },
    async close() {
      closing = true
      try {
        while (pages.size > 0) {
          const results = await Promise.allSettled([...pages].map(page => page.close()))
          const failures = results.filter(result => result.status === 'rejected')
          if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Chrome tab cleanup failed')
        }
        events.emit('close')
      } finally { closing = false }
    },
  })
}
