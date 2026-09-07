import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { apply } from '../index.js'

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
