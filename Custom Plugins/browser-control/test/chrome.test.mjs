import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { launch } from 'chrome-launcher'
import { chromium } from 'playwright'
import { apply, normalizeUrl } from '../index.js'

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
  ]) assert.throws(() => apply({ effect() { assert.fail('invalid config registered effects') } }, config))
})

test('Chrome session tabs persist cookies and disposal preserves existing user tabs and process', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-chrome-provider-'))
  const server = createServer((request, response) => {
    response.end(`<title>${request.url}</title><h1>Chrome fixture</h1>`)
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
