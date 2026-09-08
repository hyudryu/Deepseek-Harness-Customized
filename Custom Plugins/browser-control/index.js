import { mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { chromium } from 'playwright'

export const name = 'browser-control'
export const inject = ['tools', 'skills']

const SKILL_CONTENT = readFileSync(new URL('./skills/browser-control.md', import.meta.url), 'utf8')

const DEFAULTS = Object.freeze({
  headless: true,
  defaultTimeoutMs: 10_000,
  navigationTimeoutMs: 30_000,
  maxSnapshotChars: 24_000,
  maxDiagnostics: 100,
  artifactDir: '.dsh/qa-artifacts',
  maxActions: 50,
  frameQuality: 60,
})

function positiveInt(value, fallback, name) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function normalizeConfig(input = {}) {
  const frameQuality = input.frameQuality === undefined ? DEFAULTS.frameQuality : input.frameQuality
  if (!Number.isInteger(frameQuality) || frameQuality < 0 || frameQuality > 100) {
    throw new Error('frameQuality must be an integer between 0 and 100')
  }
  return {
    headless: input.headless ?? DEFAULTS.headless,
    defaultTimeoutMs: positiveInt(input.defaultTimeoutMs, DEFAULTS.defaultTimeoutMs, 'defaultTimeoutMs'),
    navigationTimeoutMs: positiveInt(input.navigationTimeoutMs, DEFAULTS.navigationTimeoutMs, 'navigationTimeoutMs'),
    maxSnapshotChars: positiveInt(input.maxSnapshotChars, DEFAULTS.maxSnapshotChars, 'maxSnapshotChars'),
    maxDiagnostics: positiveInt(input.maxDiagnostics, DEFAULTS.maxDiagnostics, 'maxDiagnostics'),
    artifactDir: typeof input.artifactDir === 'string' && input.artifactDir.trim() !== ''
      ? input.artifactDir
      : DEFAULTS.artifactDir,
    maxActions: positiveInt(input.maxActions, DEFAULTS.maxActions, 'maxActions'),
    frameQuality,
  }
}

function sessionKey(exec) {
  // Each chat session owns its own browser instance.
  return exec?.agent?.session?.id ?? exec?.agent?.id ?? 'agentless'
}

function workspaceRoot(exec) {
  return exec?.agent?.session?.header?.cwd ?? process.cwd()
}

function limitPush(array, value, max) {
  array.push(value)
  if (array.length > max) array.splice(0, array.length - max)
}

function emptyDiagnostics() {
  return { console: [], pageErrors: [], requestFailures: [], httpErrors: [] }
}

function attachPage(state, page, maxDiagnostics) {
  if (state.attached.has(page)) return
  state.attached.add(page)

  page.on('console', message => {
    const type = message.type()
    if (!['error', 'warning'].includes(type)) return
    limitPush(state.diagnostics.console, {
      type,
      text: message.text(),
    }, maxDiagnostics)
  })

  page.on('pageerror', error => {
    limitPush(state.diagnostics.pageErrors, { message: error.message }, maxDiagnostics)
  })

  page.on('requestfailed', request => {
    limitPush(state.diagnostics.requestFailures, {
      method: request.method(),
      url: request.url(),
      error: request.failure()?.errorText ?? 'request failed',
    }, maxDiagnostics)
  })

  page.on('response', response => {
    if (response.status() < 400) return
    limitPush(state.diagnostics.httpErrors, {
      status: response.status(),
      url: response.url(),
    }, maxDiagnostics)
  })
}

function requireString(args, key) {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`browser action ${args.action}: ${key} is required`)
  }
  return value
}

function resolveLocator(page, args) {
  if (typeof args.selector === 'string' && args.selector.trim() !== '') {
    return page.locator(args.selector)
  }
  if (typeof args.role === 'string' && args.role.trim() !== '') {
    const options = {}
    if (typeof args.name === 'string') options.name = args.name
    if (typeof args.exact === 'boolean') options.exact = args.exact
    return page.getByRole(args.role, options)
  }
  if (typeof args.label === 'string' && args.label.trim() !== '') {
    return page.getByLabel(args.label, { exact: args.exact ?? false })
  }
  if (typeof args.placeholder === 'string' && args.placeholder.trim() !== '') {
    return page.getByPlaceholder(args.placeholder, { exact: args.exact ?? false })
  }
  if (typeof args.test_id === 'string' && args.test_id.trim() !== '') {
    return page.getByTestId(args.test_id)
  }
  if (typeof args.text === 'string' && args.text.trim() !== '') {
    return page.getByText(args.text, { exact: args.exact ?? false })
  }
  throw new Error(`browser action ${args.action}: provide a semantic locator (role/name, label, placeholder, test_id, text) or selector`)
}

function compactText(value, max) {
  if (value.length <= max) return { text: value, truncated: false }
  return { text: `${value.slice(0, max)}\n…[truncated]`, truncated: true }
}

async function pollAssertion(fn, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() <= deadline) {
    if (signal?.aborted) throw new Error('browser assertion aborted')
    try {
      const result = await fn()
      last = result.actual
      if (result.passed) return result
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolveTimer => setTimeout(resolveTimer, 100))
  }
  return { passed: false, actual: last === undefined ? 'timed out' : String(last) }
}

function asString(value) {
  return value === null || value === undefined ? '' : String(value)
}

function outputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'action'],
    properties: {
      ok: { type: 'boolean' },
      action: { type: 'string' },
      url: { type: 'string' },
      title: { type: 'string' },
      snapshot: { type: 'string' },
      truncated: { type: 'boolean' },
      passed: { type: 'boolean' },
      actual: { type: 'string' },
      screenshotPath: { type: 'string' },
      activePage: { type: 'integer' },
      pages: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'url', 'title'],
          properties: {
            index: { type: 'integer' },
            url: { type: 'string' },
            title: { type: 'string' },
          },
        },
      },
      diagnostics: {
        type: 'object',
        additionalProperties: true,
      },
    },
  }
}

export function apply(ctx, rawConfig = {}) {
  const config = normalizeConfig(rawConfig)
  const states = new Map()
  const pendingStates = new Map()
  const subscribers = new Map()
  let browserPromise

  async function browser() {
    if (!browserPromise) {
      browserPromise = chromium.launch({ headless: config.headless }).catch(error => {
        browserPromise = undefined
        throw error
      })
    }
    return browserPromise
  }

  function makeSnapshot(state) {
    return {
      open: state.open,
      url: state.page ? state.page.url() : state.url ?? '',
      title: state.page ? state.title ?? '' : state.title ?? '',
      actions: [...state.actions],
      ...(state.frame ? {
        frame: state.frame,
        frameWidth: state.frameWidth,
        frameHeight: state.frameHeight,
      } : {}),
    }
  }

  function closedSnapshot() {
    return { open: false, url: '', title: '', actions: [] }
  }

  async function captureFrame(page) {
    try {
      const buffer = await page.screenshot({ type: 'jpeg', quality: config.frameQuality, fullPage: false })
      const viewport = page.viewportSize()
      return {
        frame: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        frameWidth: viewport?.width,
        frameHeight: viewport?.height,
      }
    } catch {
      return {}
    }
  }

  function recordAction(state, action, args, ok, clickX, clickY) {
    state.seq += 1
    const entry = {
      id: state.seq,
      action,
      args: args === undefined ? '' : JSON.stringify(args ?? {}),
      ok: Boolean(ok),
      url: state.page ? state.page.url() : '',
      time: Date.now(),
      ...(state.page ? {
        viewportWidth: state.page.viewportSize()?.width,
        viewportHeight: state.page.viewportSize()?.height,
      } : {}),
      ...(Number.isFinite(clickX) && Number.isFinite(clickY) ? { clickX, clickY } : {}),
    }
    limitPush(state.actions, entry, config.maxActions)
  }

  async function refreshAndNotify(state) {
    if (state.open && state.page) {
      const frame = await captureFrame(state.page)
      state.frame = frame.frame
      state.frameWidth = frame.frameWidth
      state.frameHeight = frame.frameHeight
      state.url = state.page.url()
      state.title = await state.page.title().catch(() => '')
    }
    const snapshot = makeSnapshot(state)
    for (const listener of subscribers.get(state.key) ?? []) {
      try { listener(snapshot) } catch { /* an observer failure never breaks the session */ }
    }
    return snapshot
  }

  async function createStateFor(key) {
    const instance = await browser()
    const context = await instance.newContext()
    context.setDefaultTimeout(config.defaultTimeoutMs)
    context.setDefaultNavigationTimeout(config.navigationTimeoutMs)
    const state = {
      key,
      context,
      page: undefined,
      diagnostics: emptyDiagnostics(),
      attached: new WeakSet(),
      actions: [],
      seq: 0,
      open: true,
      url: '',
      title: '',
      frame: undefined,
      frameWidth: undefined,
      frameHeight: undefined,
    }
    context.on('page', page => {
      attachPage(state, page, config.maxDiagnostics)
      state.page = page
    })
    context.on('close', () => {
      state.open = false
      if (states.get(key) === state) states.delete(key)
      for (const listener of subscribers.get(key) ?? []) {
        try { listener(closedSnapshot()) } catch { /* an observer failure never breaks the session */ }
      }
    })
    state.page = await context.newPage()
    attachPage(state, state.page, config.maxDiagnostics)
    states.set(key, state)
    return state
  }

  async function getState(key) {
    const existing = states.get(key)
    if (existing?.open) return { state: existing, created: false }
    const pending = pendingStates.get(key)
    if (pending) return { state: await pending, created: false }
    const created = createStateFor(key).finally(() => pendingStates.delete(key))
    pendingStates.set(key, created)
    return { state: await created, created: true }
  }

  async function closeState(key) {
    await pendingStates.get(key)
    const state = states.get(key)
    if (!state) return
    await state.context.close()
    if (states.get(key) === state) states.delete(key)
    state.open = false
  }

  ctx.effect(() => {
    return async () => {
      subscribers.clear()
      await Promise.allSettled([...pendingStates.values()])
      const results = await Promise.allSettled([...states.keys()].map(closeState))
      const instance = browserPromise ? await browserPromise.catch(() => undefined) : undefined
      if (instance) results.push(...await Promise.allSettled([instance.close()]))
      const failure = results.find(result => result.status === 'rejected')
      if (failure) throw failure.reason
    }
  })

  ctx.effect(() => ctx.skills.register({
    name: 'browser-control',
    description: 'Operate and inspect browser applications with semantic Playwright locators, deterministic assertions, diagnostics, responsive viewports, and screenshots. Load for browser interaction or browser QA.',
    source: 'runtime',
    content: SKILL_CONTENT,
    invocation: { modelInvocable: true, userInvocable: true },
  }))

  ctx.effect(() => ctx.provide('browserControl', {
    snapshot(sessionId) {
      const state = states.get(sessionId)
      return state?.open ? makeSnapshot(state) : closedSnapshot()
    },
    subscribe(sessionId, listener) {
      let set = subscribers.get(sessionId)
      if (!set) {
        set = new Set()
        subscribers.set(sessionId, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
        if (set.size === 0) subscribers.delete(sessionId)
      }
    },
    async open(sessionId, url) {
      const { state, created } = await getState(sessionId)
      if (typeof url === 'string' && url.trim() !== '') {
        try {
          await state.page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs })
        } catch (error) {
          // Only the call that created the state may roll it back; a racing
          // caller must not close a context a peer created and put in use.
          if (created) {
            try { await closeState(sessionId) }
            catch (cleanupError) {
              await refreshAndNotify(state)
              throw new AggregateError([error, cleanupError], 'Initial navigation and browser cleanup failed')
            }
          } else {
            await refreshAndNotify(state)
          }
          throw error
        }
      }
      state.open = true
      await refreshAndNotify(state)
    },
    async close(sessionId) {
      await closeState(sessionId)
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'browser',
    description: 'Control a persistent Playwright Chromium context for the current agent. Prefer semantic locators. Use snapshot to inspect UI, assert for deterministic pass/fail, diagnostics for console/network failures, and screenshot for visual evidence.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'reload', 'back', 'snapshot', 'click', 'fill', 'press', 'select', 'check', 'uncheck', 'assert', 'diagnostics', 'clear_diagnostics', 'screenshot', 'viewport', 'pages', 'switch_page', 'close'],
        },
        url: { type: 'string' },
        role: { type: 'string' },
        name: { type: 'string' },
        label: { type: 'string' },
        placeholder: { type: 'string' },
        text: { type: 'string' },
        test_id: { type: 'string' },
        selector: { type: 'string' },
        exact: { type: 'boolean' },
        value: { type: 'string' },
        key: { type: 'string' },
        assertion: {
          type: 'string',
          enum: ['visible', 'hidden', 'enabled', 'disabled', 'checked', 'unchecked', 'text_contains', 'text_equals', 'value_equals', 'url_contains', 'url_equals', 'count_equals'],
        },
        expected: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
        timeout_ms: { type: 'number' },
        full_page: { type: 'boolean' },
        path: { type: 'string' },
        include_boxes: { type: 'boolean' },
        depth: { type: 'integer' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        page_index: { type: 'integer' },
      },
    },
    output: {
      schema: outputSchema(),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (exec.signal?.aborted) throw new Error('browser call aborted')
      const action = args.action
      const key = sessionKey(exec)
      if (action === 'close') {
        await closeState(key)
        return { ok: true, action }
      }
      const { state } = await getState(key)
      const page = state.page
      const timeoutMs = Number.isFinite(args.timeout_ms) && args.timeout_ms > 0
        ? Math.floor(args.timeout_ms)
        : config.defaultTimeoutMs

      let result
      let clickX
      let clickY

      try {
        switch (action) {
          case 'open': {
            const url = requireString(args, 'url')
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs })
            result = { ok: true, action, url: page.url(), title: await page.title() }
            break
          }
          case 'reload':
            await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs })
            result = { ok: true, action, url: page.url(), title: await page.title() }
            break
          case 'back':
            await page.goBack({ waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs })
            result = { ok: true, action, url: page.url(), title: await page.title() }
            break
          case 'snapshot': {
            const depth = Number.isInteger(args.depth) && args.depth > 0 ? args.depth : 12
            const yaml = await page.locator('body').ariaSnapshot({
              mode: 'ai',
              depth,
              boxes: args.include_boxes ?? false,
              timeout: timeoutMs,
            })
            const snapshot = compactText(yaml, config.maxSnapshotChars)
            result = { ok: true, action, url: page.url(), snapshot: snapshot.text, truncated: snapshot.truncated }
            break
          }
          case 'click': {
            const locator = resolveLocator(page, args)
            const box = await locator.boundingBox()
            if (box) {
              clickX = Math.round(box.x + box.width / 2)
              clickY = Math.round(box.y + box.height / 2)
            }
            await locator.click({ timeout: timeoutMs })
            result = { ok: true, action, url: page.url() }
            break
          }
          case 'fill':
            await resolveLocator(page, args).fill(requireString(args, 'value'), { timeout: timeoutMs })
            result = { ok: true, action, url: page.url() }
            break
          case 'press': {
            const key0 = requireString(args, 'key')
            const hasLocator = ['selector', 'role', 'label', 'placeholder', 'test_id', 'text'].some(k => typeof args[k] === 'string' && args[k] !== '')
            if (hasLocator) await resolveLocator(page, args).press(key0, { timeout: timeoutMs })
            else await page.keyboard.press(key0)
            result = { ok: true, action, url: page.url() }
            break
          }
          case 'select':
            await resolveLocator(page, args).selectOption(requireString(args, 'value'), { timeout: timeoutMs })
            result = { ok: true, action, url: page.url() }
            break
          case 'check':
            await resolveLocator(page, args).check({ timeout: timeoutMs })
            result = { ok: true, action, url: page.url() }
            break
          case 'uncheck':
            await resolveLocator(page, args).uncheck({ timeout: timeoutMs })
            result = { ok: true, action, url: page.url() }
            break
          case 'assert': {
            const assertion = requireString(args, 'assertion')
            const outcome = await pollAssertion(async () => {
              if (assertion === 'url_contains') {
                const expected = asString(args.expected)
                const actual = page.url()
                return { passed: actual.includes(expected), actual }
              }
              if (assertion === 'url_equals') {
                const expected = asString(args.expected)
                const actual = page.url()
                return { passed: actual === expected, actual }
              }
              const locator = resolveLocator(page, args)
              if (assertion === 'visible') return { passed: await locator.isVisible(), actual: String(await locator.isVisible()) }
              if (assertion === 'hidden') return { passed: !(await locator.isVisible()), actual: String(await locator.isVisible()) }
              if (assertion === 'enabled') return { passed: await locator.isEnabled(), actual: String(await locator.isEnabled()) }
              if (assertion === 'disabled') return { passed: !(await locator.isEnabled()), actual: String(await locator.isEnabled()) }
              if (assertion === 'checked') return { passed: await locator.isChecked(), actual: String(await locator.isChecked()) }
              if (assertion === 'unchecked') return { passed: !(await locator.isChecked()), actual: String(await locator.isChecked()) }
              if (assertion === 'text_contains') {
                const actual = (await locator.textContent()) ?? ''
                return { passed: actual.includes(asString(args.expected)), actual }
              }
              if (assertion === 'text_equals') {
                const actual = ((await locator.textContent()) ?? '').trim()
                return { passed: actual === asString(args.expected).trim(), actual }
              }
              if (assertion === 'value_equals') {
                const actual = await locator.inputValue()
                return { passed: actual === asString(args.expected), actual }
              }
              if (assertion === 'count_equals') {
                const actualCount = await locator.count()
                const expectedCount = Number(args.expected)
                return { passed: Number.isFinite(expectedCount) && actualCount === expectedCount, actual: String(actualCount) }
              }
              throw new Error(`unsupported assertion ${assertion}`)
            }, timeoutMs, exec.signal)
            result = { ok: true, action, url: page.url(), passed: outcome.passed, actual: asString(outcome.actual) }
            break
          }
          case 'diagnostics':
            result = { ok: true, action, url: page.url(), diagnostics: structuredClone(state.diagnostics) }
            break
          case 'clear_diagnostics':
            state.diagnostics = emptyDiagnostics()
            result = { ok: true, action, url: page.url() }
            break
          case 'screenshot': {
            const root = workspaceRoot(exec)
            const artifactDir = isAbsolute(config.artifactDir) ? config.artifactDir : resolve(root, config.artifactDir)
            await mkdir(artifactDir, { recursive: true })
            const filename = typeof args.path === 'string' && args.path.trim() !== ''
              ? args.path
              : `browser-${Date.now()}.png`
            const screenshotPath = isAbsolute(filename) ? filename : resolve(artifactDir, filename)
            await mkdir(dirname(screenshotPath), { recursive: true })
            await page.screenshot({ path: screenshotPath, fullPage: args.full_page ?? true })
            result = { ok: true, action, url: page.url(), screenshotPath }
            break
          }
          case 'viewport': {
            const width = args.width
            const height = args.height
            if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
              throw new Error('browser action viewport: width and height must be positive integers')
            }
            await page.setViewportSize({ width, height })
            result = { ok: true, action, url: page.url() }
            break
          }
          case 'pages': {
            const pages = await Promise.all(state.context.pages().map(async (candidate, index) => ({
              index,
              url: candidate.url(),
              title: await candidate.title().catch(() => ''),
            })))
            const activePage = Math.max(0, state.context.pages().indexOf(state.page))
            result = { ok: true, action, pages, activePage }
            break
          }
          case 'switch_page': {
            const pages = state.context.pages()
            if (!Number.isInteger(args.page_index) || args.page_index < 0 || args.page_index >= pages.length) {
              throw new Error(`browser action switch_page: page_index must be between 0 and ${Math.max(0, pages.length - 1)}`)
            }
            state.page = pages[args.page_index]
            await state.page.bringToFront()
            result = { ok: true, action, url: state.page.url(), title: await state.page.title(), activePage: args.page_index }
            break
          }
          default:
            throw new Error(`unsupported browser action: ${action}`)
        }
      } catch (error) {
        recordAction(state, action, args, false, clickX, clickY)
        await refreshAndNotify(state).catch(() => {})
        throw error
      }

      recordAction(state, action, args, true, clickX, clickY)
      await refreshAndNotify(state).catch(() => {})
      return result
    },
  }))
}
