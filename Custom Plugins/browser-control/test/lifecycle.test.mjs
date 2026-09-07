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
  }, config)
  async function dispose() {
    for (const disposer of disposers.reverse()) await disposer?.()
  }
  t.after(dispose)
  return { context, page, browser, control, tool, dispose }
}

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
  let finish
  context.close.mock.mockImplementation(() => new Promise(resolve => {
    finish = () => { context.emit('close'); resolve() }
  }))
  const closing = control.close('session')
  await Promise.resolve()
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

test('a failed initial navigation publishes the open browser so a subscriber can stop it', async t => {
  const { page, control } = fixture(t)
  const updates = []
  control.subscribe('session', value => updates.push(value))
  page.goto = async () => { throw new Error('navigation failed') }
  await assert.rejects(control.open('session', 'https://unreachable.invalid'), /navigation failed/)
  assert.equal(updates.at(-1).open, true)
  assert.equal(control.snapshot('session').open, true)
  await control.close('session')
  assert.equal(updates.at(-1).open, false)
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
