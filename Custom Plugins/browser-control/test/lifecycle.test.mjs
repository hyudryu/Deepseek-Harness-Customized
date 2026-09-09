import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { chromium } from 'playwright'
import { apply } from '../index.js'

function fixture(t, config = {}) {
  const context = new EventEmitter()
  const page = new EventEmitter()
  page.url = () => 'about:blank'
  page.title = async () => ''
  page.viewportSize = () => ({ width: 800, height: 600 })
  page.screenshot = t.mock.fn(async () => Buffer.from('frame'))
  page.goto = async () => {}
  context.setDefaultTimeout = () => {}
  context.setDefaultNavigationTimeout = () => {}
  context.pages = () => [page]
  context.newPage = async () => page
  context.close = t.mock.fn(async () => { context.emit('close') })
  const browser = { newContext: async () => context, close: t.mock.fn(async () => {}) }
  t.mock.method(chromium, 'launch', async () => browser)
  const disposers = []
  let control
  let tool
  apply({
    effect(callback) { disposers.push(callback()) },
    provide(_name, value) { control = value },
    skills: { register() {} },
    tools: { register(value) { tool = value } },
  }, { backend: 'playwright', homepage: 'about:blank', ...config })
  async function dispose() {
    for (const disposer of disposers.reverse()) await disposer?.()
  }
  t.after(dispose)
  return { context, page, browser, control, tool, dispose }
}

test('IPv6 loopback remains the endpoint used by the Chrome transport', async t => {
  const probe = t.mock.method(globalThis, 'fetch', async () => new Response('{}'))
  const transportFailure = new Error('transport stopped before allocation')
  const connect = t.mock.method(chromium, 'connectOverCDP', async () => { throw transportFailure })
  const { control } = fixture(t, { backend: 'chrome', chromeEndpoint: 'http://[::1]:9222' })
  await assert.rejects(control.open('session'), error => error === transportFailure)
  assert.equal(probe.mock.calls[0].arguments[0], 'http://[::1]:9222/json/version')
  assert.equal(connect.mock.calls[0].arguments[0], 'http://[::1]:9222')
})

test('new-tab navigation and rollback failures preserve both errors and allow cleanup retry', async t => {
  const { context, page, control } = fixture(t)
  await control.open('session')
  const tab = new EventEmitter()
  tab.url = () => 'about:blank'
  tab.title = async () => ''
  tab.viewportSize = page.viewportSize
  tab.screenshot = page.screenshot
  const navigationFailure = new Error('tab navigation failed')
  const cleanupFailure = new Error('tab cleanup failed')
  tab.goto = async () => { throw navigationFailure }
  tab.close = t.mock.fn(async () => { throw cleanupFailure })
  context.newPage = async () => tab
  context.pages = () => [page, tab]
  await assert.rejects(control.createTab('session', 'https://unreachable.invalid'), error => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [navigationFailure, cleanupFailure])
    return true
  })
  const failedTabId = control.snapshot('session').activeTabId
  assert.equal(control.snapshot('session').tabs.length, 2)
  tab.close.mock.mockImplementation(async () => { context.pages = () => [page]; tab.emit('close') })
  await control.closeTab('session', failedTabId)
  assert.equal(control.snapshot('session').tabs.length, 1)
  assert.equal(control.snapshot('session').open, true)
})

test('failed context cleanup rejects both callers and leaves the browser available for retry', async t => {
  const { context, control, tool } = fixture(t)
  const updates = []
  control.subscribe('session', value => updates.push(value))
  await control.open('session')
  context.close.mock.mockImplementation(async () => { throw new Error('close failed') })
  await assert.rejects(control.close('session'), /close failed/)
  await assert.rejects(tool.execute({ action: 'close' }, { agent: { session: { id: 'session' } } }), /close failed/)
  assert.equal(control.snapshot('session').open, true)
  assert.equal(updates.at(-1).open, true)
  context.close.mock.mockImplementation(async () => { context.emit('close') })
  await control.close('session')
  assert.equal(control.snapshot('session').open, false)
  assert.equal(updates.at(-1).open, false)
})

test('open state remains visible while context cleanup is pending', async t => {
  const { context, control } = fixture(t)
  await control.open('session')
  let cleanupStarted
  const started = new Promise(resolve => { cleanupStarted = resolve })
  let finish
  context.close.mock.mockImplementation(() => new Promise(resolve => {
    cleanupStarted()
    finish = () => { context.emit('close'); resolve() }
  }))
  const closing = control.close('session')
  await started
  assert.equal(control.snapshot('session').open, true)
  finish()
  await closing
  assert.equal(control.snapshot('session').open, false)
})

test('disposal still closes the browser when context cleanup fails', async t => {
  const { context, browser, control, dispose } = fixture(t)
  await control.open('session')
  context.close.mock.mockImplementation(async () => { throw new Error('close failed') })
  await assert.rejects(dispose(), /close failed/)
  assert.equal(browser.close.mock.callCount(), 1)
  context.close.mock.mockImplementation(async () => { context.emit('close') })
})

test('a failed initial navigation closes the new context before rejecting', async t => {
  const { page, context, control } = fixture(t)
  const updates = []
  control.subscribe('session', value => updates.push(value))
  page.goto = async () => { throw new Error('navigation failed') }
  let finishClose
  const closing = new Promise(resolve => { finishClose = resolve })
  context.close.mock.mockImplementation(async () => { await closing; context.emit('close') })
  let settled = false
  const opening = control.open('session', 'https://unreachable.invalid')
  const rejected = assert.rejects(opening, /navigation failed/).then(() => { settled = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  assert.equal(context.close.mock.callCount(), 1)
  finishClose()
  await rejected
  assert.equal(context.close.mock.callCount(), 1)
  assert.equal(updates.at(-1).open, false)
  assert.equal(control.snapshot('session').open, false)
})

test('failed navigation preserves an already open context', async t => {
  const { page, context, control } = fixture(t)
  await control.open('session')
  page.goto = async () => { throw new Error('navigation failed') }
  await assert.rejects(control.open('session', 'https://unreachable.invalid'), /navigation failed/)
  assert.equal(context.close.mock.callCount(), 0)
  assert.equal(control.snapshot('session').open, true)
})

test('failed initial navigation reports rollback failure and permits cleanup retry', async t => {
  const { page, context, control } = fixture(t)
  page.goto = async () => { throw new Error('navigation failed') }
  context.close.mock.mockImplementation(async () => { throw new Error('close failed') })
  await assert.rejects(control.open('session', 'https://unreachable.invalid'), error => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors.map(cause => cause.message), ['navigation failed', 'close failed'])
    return true
  })
  assert.equal(control.snapshot('session').open, true)
  context.close.mock.mockImplementation(async () => { context.emit('close') })
  await control.close('session')
  assert.equal(control.snapshot('session').open, false)
})

test('failed initial navigation rolls back before a concurrent open adopts the context', async t => {
  const { page, context, control } = fixture(t)
  let navigationStarted
  const started = new Promise(resolve => { navigationStarted = resolve })
  let failNavigation
  page.goto = async () => {
    navigationStarted()
    await new Promise((_, reject) => { failNavigation = () => reject(new Error('navigation failed')) })
  }
  const first = control.open('session', 'https://unreachable.invalid')
  await started
  let peerSettled = false
  const peer = control.open('session').then(() => { peerSettled = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(peerSettled, false)
  failNavigation()
  await assert.rejects(first, /navigation failed/)
  await peer
  assert.equal(context.close.mock.callCount(), 1)
  assert.equal(control.snapshot('session').open, true)
})

test('a close issued after a queued open leaves the session closed', async t => {
  const { page, context, control } = fixture(t)
  let navigationStarted
  const started = new Promise(resolve => { navigationStarted = resolve })
  let failNavigation
  page.goto = async () => {
    navigationStarted()
    await new Promise((_, reject) => { failNavigation = () => reject(new Error('navigation failed')) })
  }
  const first = control.open('session', 'https://unreachable.invalid')
  await started
  const peer = control.open('session')
  const closing = control.close('session')
  failNavigation()
  await assert.rejects(first, /navigation failed/)
  await peer
  await closing
  assert.equal(context.close.mock.callCount(), 2)
  assert.equal(control.snapshot('session').open, false)
})

test('concurrent browser tool opens navigate in issued order', async t => {
  const { page, tool } = fixture(t)
  let firstStarted
  const started = new Promise(resolve => { firstStarted = resolve })
  let releaseFirst
  const blocked = new Promise(resolve => { releaseFirst = resolve })
  let gotoCalls = 0
  page.goto = async () => {
    gotoCalls += 1
    if (gotoCalls === 1) {
      firstStarted()
      await blocked
    }
  }
  const exec = { agent: { session: { id: 'session' } } }
  const first = tool.execute({ action: 'open', url: 'https://first.invalid' }, exec)
  await started
  const second = tool.execute({ action: 'open', url: 'https://second.invalid' }, exec)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(gotoCalls, 1)
  releaseFirst()
  await Promise.all([first, second])
  assert.equal(gotoCalls, 2)
})

test('tab listing bounds the complete result including its action acknowledgement', async t => {
  const id = '0'.repeat(36)
  const partial = { tabs: [{ id, url: 'about:blank', title: '' }], activeTabId: id }
  const { control, tool } = fixture(t, { maxSnapshotChars: JSON.stringify(partial).length })
  await control.open('session')
  await assert.rejects(tool.execute({ action: 'tabs' }, { agent: { session: { id: 'session' } } }), /exceeds maxSnapshotChars/)
})

test('tab listing accepts a complete result exactly at the configured limit', async t => {
  const id = '0'.repeat(36)
  const complete = { ok: true, action: 'tabs', tabs: [{ id, url: 'about:blank', title: '' }], activeTabId: id }
  const limit = JSON.stringify(complete).length
  const { control, tool } = fixture(t, { maxSnapshotChars: limit })
  await control.open('session')
  const result = await tool.execute({ action: 'tabs' }, { agent: { session: { id: 'session' } } })
  assert.equal(JSON.stringify(result).length, limit)
})

test('closing the last tab also bounds its complete empty listing', async t => {
  const { control, tool } = fixture(t, { maxSnapshotChars: JSON.stringify({ tabs: [] }).length })
  await control.open('session')
  const tab_id = control.snapshot('session').activeTabId
  await assert.rejects(tool.execute({ action: 'close_tab', tab_id }, { agent: { session: { id: 'session' } } }), /exceeds maxSnapshotChars/)
  assert.equal(control.snapshot('session').open, false)
})

for (const quality of [0, 60, 100]) {
  test(`JPEG quality ${quality} reaches the screenshot request`, async t => {
    const { page, control } = fixture(t, { frameQuality: quality })
    await control.open('session')
    assert.equal(page.screenshot.mock.calls[0].arguments[0].quality, quality)
  })
}

for (const quality of [-1, 101, 0.5, NaN, '60', null]) {
  test(`invalid JPEG quality ${String(quality)} rejects during plugin configuration`, () => {
    assert.throws(() => apply({}, { frameQuality: quality }), /frameQuality must be an integer between 0 and 100/)
  })
}
