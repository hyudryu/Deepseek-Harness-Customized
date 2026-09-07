import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { EventEmitter } from 'node:events'
import { chromium } from 'playwright'
import { apply } from '../index.js'

function harness(config) {
  const disposers = []
  const result = { disposers }
  apply({
    effect(callback) { disposers.push(callback()) },
    provide(_name, service) { result.control = service },
    skills: { register() {} },
    tools: { register(tool) { result.tool = tool } },
  }, config)
  return result
}

function mockBrowser(t) {
  const contexts = []
  const qualities = []
  let browserCloseError
  const instance = {
    async newContext() {
      const context = new EventEmitter()
      context.setDefaultTimeout = () => {}
      context.setDefaultNavigationTimeout = () => {}
      const page = new EventEmitter()
      page.url = () => 'about:blank'
      page.title = async () => 'Fixture'
      page.viewportSize = () => ({ width: 800, height: 600 })
      page.screenshot = async ({ quality }) => { qualities.push(quality); return Buffer.from('frame') }
      context.newPage = async () => page
      context.close = t.mock.fn(async () => {
        if (context.closeError) throw context.closeError
        context.emit('close')
      })
      contexts.push(context)
      return context
    },
    close: t.mock.fn(async () => { if (browserCloseError) throw browserCloseError }),
  }
  t.mock.method(chromium, 'launch', async () => instance)
  return { contexts, qualities, instance, failBrowserClose(error) { browserCloseError = error } }
}

test('frame quality rejects invalid configuration before registering effects', () => {
  for (const frameQuality of [-1, 101, 0.5, NaN, Infinity, '60', null]) {
    assert.throws(() => apply({ effect() { assert.fail('invalid configuration registered an effect') } }, { frameQuality }),
      /frameQuality must be an integer between 0 and 100/)
  }
})

test('frame quality passes inclusive endpoints and the default to screenshots', async t => {
  const browser = mockBrowser(t)
  for (const frameQuality of [0, 100, undefined]) {
    const { control, disposers } = harness({ frameQuality })
    await control.open('session')
    assert.equal(browser.qualities.at(-1), frameQuality ?? 60)
    assert.match(control.snapshot('session').frame, /^data:image\/jpeg;base64,/)
    for (const dispose of disposers.reverse()) await dispose?.()
  }
})

test('failed panel and tool closes retain the context and subscriptions until retry succeeds', async t => {
  const browser = mockBrowser(t)
  const { control, tool, disposers } = harness()
  const updates = []
  control.subscribe('session', value => updates.push(value))
  await control.open('session')
  const before = control.snapshot('session')
  const context = browser.contexts[0]
  const failure = new Error('context close failed')
  context.closeError = failure
  await assert.rejects(control.close('session'), error => error === failure)
  await assert.rejects(tool.execute({ action: 'close' }, { agent: { session: { id: 'session' } } }), error => error === failure)
  assert.deepEqual(control.snapshot('session'), before)
  assert.equal(updates.length, 1, 'failed closes do not publish a false stopped state')
  await control.open('session')
  assert.equal(browser.contexts.length, 1, 'retry uses the retained context')
  context.closeError = undefined
  assert.deepEqual(await tool.execute({ action: 'close' }, { agent: { session: { id: 'session' } } }), { ok: true, action: 'close' })
  assert.equal(context.close.mock.callCount(), 3)
  assert.equal(control.snapshot('session').open, false)
  assert.equal(updates.at(-1).open, false)
  await control.open('session')
  assert.equal(browser.contexts.length, 2)
  assert.equal(updates.at(-1).open, true, 'the subscription survives reopening')
  for (const dispose of disposers.reverse()) await dispose?.()
})

test('disposal reports close failures and can retry retained resources', async t => {
  const browser = mockBrowser(t)
  const { control, disposers } = harness()
  await control.open('session')
  const dispose = disposers[0]
  const context = browser.contexts[0]
  context.closeError = new Error('context failure')
  await assert.rejects(dispose(), /context failure/)
  assert.equal(control.snapshot('session').open, true)
  assert.equal(browser.instance.close.mock.callCount(), 0)
  context.closeError = undefined
  browser.failBrowserClose(new Error('browser failure'))
  await assert.rejects(dispose(), /browser failure/)
  assert.equal(control.snapshot('session').open, false)
  browser.failBrowserClose(undefined)
  await dispose()
  assert.equal(browser.instance.close.mock.callCount(), 2)
})

test('the panel and browser tool share a context across navigation, close, and reopen', { timeout: 30000 }, async () => {
  const disposers = []
  let control
  let tool
  apply({
    effect(callback) { disposers.push(callback()) },
    provide(name, service) { assert.equal(name, 'browserControl'); control = service },
    skills: { register() {} },
    tools: { register(value) { tool = value } },
  })
  const server = createServer((_req, res) => {
    res.end('<title>Browser fixture</title><h1>Browser works</h1><button onclick="this.textContent=\'Clicked\'">Try it</button>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  const updates = []
  const unsubscribe = control.subscribe('session', value => updates.push(value))
  const exec = { agent: { session: { id: 'session' } } }
  try {
    assert.equal(control.snapshot('session').open, false)
    await Promise.all([control.open('session'), control.open('session')])
    await control.open('session', url)
    const opened = control.snapshot('session')
    assert.equal(opened.url, url)
    assert.equal(opened.title, 'Browser fixture')
    assert.match(opened.frame, /^data:image\/jpeg;base64,/)
    await tool.execute({ action: 'click', role: 'button', name: 'Try it' }, exec)
    const result = await tool.execute({ action: 'snapshot' }, exec)
    assert.match(result.snapshot, /Clicked/)
    assert.equal(control.snapshot('session').actions.length, 2)
    assert.equal(opened.actions.length, 0, 'previous snapshots stay immutable')
    await control.close('session')
    assert.equal(control.snapshot('session').open, false)
    assert.equal(updates.at(-1).open, false)
    await control.open('session', url)
    assert.equal(control.snapshot('session').title, 'Browser fixture')
    assert.equal(control.snapshot('session').actions.length, 0)
  } finally {
    unsubscribe()
    for (const dispose of disposers.reverse()) await dispose?.()
    await new Promise(resolve => server.close(resolve))
  }
})
