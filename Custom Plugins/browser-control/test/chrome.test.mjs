import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { launch } from 'chrome-launcher'
import { chromium } from 'playwright'
import { apply, normalizeUrl } from '../index.js'
import { chromeLaunchFlags } from '../chrome-backend.js'

test('addresses normalize before navigation and reject unsupported schemes', () => {
  assert.equal(normalizeUrl(' jackandjill.com '), 'https://jackandjill.com/')
  assert.equal(normalizeUrl('example.com:8080/path'), 'https://example.com:8080/path')
  assert.equal(normalizeUrl('localhost:3000/path'), 'http://localhost:3000/path')
  assert.equal(normalizeUrl('127.0.0.1:3000'), 'http://127.0.0.1:3000/')
  assert.equal(normalizeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1')
  assert.equal(normalizeUrl('about:blank'), 'about:blank')
  for (const url of ['', 'javascript:alert(1)', 'file:///tmp/file', 'about:config']) assert.throws(() => normalizeUrl(url))
})

test('Chrome configuration rejects nonlocal endpoints and invalid backend before effects', () => {
  for (const config of [
    { chromeEndpoint: 'http://example.com:9222' }, { chromeEndpoint: 'https://localhost:9222' },
    { chromeEndpoint: 'http://127.0.0.1:9222/path' }, { chromeEndpoint: 'http://user@localhost:9222' },
    { backend: 'firefox' }, { chromeUserDataDir: '' }, { chromeExecutablePath: 'relative' },
    { chromeHeadless: 'yes' }, { frameQuality: 200 },
  ]) assert.throws(() => apply({ effect() { assert.fail('invalid config registered effects') } }, config))
})

test('the launched session Chrome stays hidden unless visibility is requested', () => {
  const hidden = chromeLaunchFlags({ chromeHeadless: true })
  assert.ok(hidden.includes('--headless=new'))
  assert.ok(hidden.includes('--window-size=1280,800'))
  const shown = chromeLaunchFlags({ chromeHeadless: false })
  assert.deepEqual(shown.filter(flag => flag.startsWith('--headless')), [])
  for (const flags of [hidden, shown]) {
    assert.ok(flags.includes('--no-first-run'))
    assert.ok(flags.includes('--no-default-browser-check'))
    assert.ok(flags.includes('--remote-debugging-address=127.0.0.1'))
  }
})

test('Chrome session tabs persist cookies and disposal preserves existing user tabs and process', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-chrome-provider-'))
  const server = createServer((request, response) => {
    response.end(`<title>${request.url}</title><h1>Chrome fixture</h1>
      <button id="press">Press</button><output id="presses">0</output>
      <input id="field" aria-label="Field"><output id="typed"></output>
      <script>
        document.querySelector('#press').addEventListener('click', () => {
          const presses = document.querySelector('#presses')
          presses.textContent = String(Number(presses.textContent) + 1)
        })
        document.querySelector('#field').addEventListener('input', (event) => {
          document.querySelector('#typed').textContent = event.target.value
        })
      </script>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  let launched
  let observer
  const disposers = []
  let control
  let tool
  try {
    launched = await launch({ port: 0, userDataDir: root, handleSIGINT: false,
      chromeFlags: ['--headless=new', '--no-first-run', '--no-default-browser-check'] })
    const port = launched.port
    observer = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const shared = observer.contexts()[0]
    const existing = await shared.newPage()
    await existing.goto(`${origin}/existing-user-tab`)
    await shared.addCookies([{ name: 'session', value: 'preserved', url: origin }])
    apply({
      effect(callback) { disposers.push(callback()) },
      provide(_name, value) { control = value },
      skills: { register() {} }, tools: { register(value) { tool = value } },
    }, { chromeEndpoint: `http://127.0.0.1:${port}`, homepage: `${origin}/home` })
    await control.open('first')
    const first = control.snapshot('first')
    assert.equal(first.url, `${origin}/home`)
    assert.equal(first.tabs.length, 1)
    assert.ok(first.frameWidth > 0 && first.frameHeight > 0)

    // Panel input drives the same page the panel mirrors: a forwarded click
    // presses the button, and forwarded text and keys reach the focused field.
    const opened = shared.pages().find(candidate => candidate.url().endsWith('/home') && candidate !== existing)
    const press = await opened.locator('#press').boundingBox()
    const center = { x: Math.round(press.x + press.width / 2), y: Math.round(press.y + press.height / 2) }
    await control.input('first', { kind: 'move', ...center })
    await control.input('first', { kind: 'down', ...center, button: 'left', clickCount: 1 })
    await control.input('first', { kind: 'up', ...center, button: 'left', clickCount: 1 })
    await control.input('first', { kind: 'down', ...center })
    await control.input('first', { kind: 'up', ...center })
    assert.equal(await opened.textContent('#presses'), '2')
    const field = await opened.locator('#field').boundingBox()
    await control.input('first', { kind: 'down', x: Math.round(field.x + 4), y: Math.round(field.y + 4) })
    await control.input('first', { kind: 'up', x: Math.round(field.x + 4), y: Math.round(field.y + 4) })
    await control.input('first', { kind: 'text', text: 'panel input' })
    assert.equal(await opened.textContent('#typed'), 'panel input')
    await control.input('first', { kind: 'wheel', ...center, deltaX: 0, deltaY: 120 })
    await control.input('first', { kind: 'key', key: 'Control+A' })
    for (const [event, message] of [
      [null, /event object/],
      [{ kind: 'tap' }, /unsupported browser input kind/],
      [{ kind: 'move', x: -1, y: 0 }, /non-negative finite numbers/],
      [{ kind: 'move', x: 1 }, /non-negative finite numbers/],
      [{ kind: 'wheel', x: 1, y: 1, deltaX: 0 }, /deltaY must be a finite number/],
      [{ kind: 'down', x: 1, y: 1, button: 'thumb' }, /left, right, or middle/],
      [{ kind: 'up', x: 1, y: 1, clickCount: 9 }, /clickCount must be an integer/],
      [{ kind: 'key', key: '' }, /key must be a non-empty string/],
      [{ kind: 'text', text: 'x'.repeat(2049) }, /text must be a non-empty string/],
    ]) {
      await assert.rejects(control.input('first', event), message)
    }
    await assert.rejects(control.input('unopened', { kind: 'move', x: 1, y: 1 }), /Session browser is closed/)

    await control.createTab('first', `${origin}/second`)
    const second = control.snapshot('first')
    assert.equal(second.tabs.length, 2)
    assert.equal(second.tabs[0].id, first.tabs[0].id)
    assert.notEqual(second.activeTabId, first.activeTabId)
    await control.selectTab('first', first.activeTabId)
    assert.equal(control.snapshot('first').url, `${origin}/home`)
    const exec = { agent: { session: { id: 'first' } } }
    const listed = await tool.execute({ action: 'tabs' }, exec)
    assert.equal(listed.tabs.length, 2)
    assert.ok(listed.tabs.every(tab => !tab.url.includes('existing-user-tab')))
    await assert.rejects(control.closeTab('first', 'foreign-user-tab'), /not owned/)
    await control.closeTab('first', first.activeTabId)
    assert.equal(control.snapshot('first').tabs.length, 1)
    await control.closeTab('first', control.snapshot('first').activeTabId)
    assert.equal(control.snapshot('first').open, false)
    await control.open('first')
    assert.equal((await shared.cookies(origin)).find(cookie => cookie.name === 'session').value, 'preserved')
    await tool.execute({ action: 'new_tab', url: `${origin}/tool-tab` }, exec)
    assert.equal(control.snapshot('first').tabs.length, 2)
    const active = control.snapshot('first').activeTabId
    await tool.execute({ action: 'close_tab', tab_id: active }, exec)
    await control.open('other')
    const otherBefore = control.snapshot('other')
    await assert.rejects(control.closeTab('other', control.snapshot('first').activeTabId), /not owned/)
    await assert.rejects(control.selectTab('other', control.snapshot('first').activeTabId), /not owned/)
    assert.deepEqual(control.snapshot('other'), otherBefore)
    await assert.rejects(tool.execute({ action: 'tabs' }, { agent: { id: 'not-a-session' } }), /require a DSH session/)
    const ownedPage = shared.pages().find(candidate => candidate.url().endsWith('/home') && candidate !== existing)
    await ownedPage.evaluate(() => { document.title = 'x'.repeat(25000) })
    await control.selectTab('first', control.snapshot('first').activeTabId)
    await assert.rejects(tool.execute({ action: 'tabs' }, exec), /exceeds maxSnapshotChars/)
    await ownedPage.evaluate(() => { document.title = 'Home' })
    await tool.execute({ action: 'open', backend: 'playwright', url: `${origin}/isolated` }, exec)
    assert.equal(control.snapshot('first').url, `${origin}/isolated`)
    for (const dispose of [...disposers].reverse()) await dispose?.()
    disposers.length = 0
    assert.equal(existing.isClosed(), false)
    assert.equal(await existing.title(), '/existing-user-tab')
    assert.equal(observer.isConnected(), true)
    process.kill(launched.pid, 0)
  } finally {
    const results = await Promise.allSettled(disposers.reverse().map(dispose => Promise.resolve().then(() => dispose?.())))
    results.push(...await Promise.allSettled([observer?.close(), launched?.kill(),
      new Promise(resolve => server.close(resolve))]))
    results.push(...await Promise.allSettled([rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })]))
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Chrome fixture cleanup failed')
  }
})
