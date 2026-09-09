import test from 'node:test'
import assert from 'node:assert/strict'
import { SidecarClient } from '../index.js'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const STUB = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'stub-sidecar.mjs')

function stubClient() {
  return new SidecarClient({
    python: process.execPath,
    script: STUB,
    cwd: process.cwd(),
    env: { ...process.env },
    logger: undefined,
    startTimeoutMs: 20_000,
  })
}

test('client starts with a ping and resolves replies', async () => {
  const client = stubClient()
  try {
    const pong = await client.start()
    assert.equal(pong.version, 'stub')
    const result = await client.request('run', { task: 'open example' }, 20_000)
    assert.equal(result.final_result, 'did: open example')
    assert.equal(result.screenshot_path, 'stub-shot.png')
  } finally {
    await client.kill()
  }
})

test('client rejects error replies with the sidecar message', async () => {
  const client = stubClient()
  try {
    await client.start()
    await assert.rejects(client.request('fail', {}, 20_000), /requested failure/)
  } finally {
    await client.kill()
  }
})

test('client ignores log events and non-protocol lines, then resolves the reply', async () => {
  const client = stubClient()
  try {
    await client.start()
    await client.request('log-event', {}, 20_000)
    await client.request('not-json-followed-by-reply', {}, 20_000)
  } finally {
    await client.kill()
  }
})

test('client rejects requests after exit and kill resolves', async () => {
  const client = stubClient()
  await client.start()
  await client.kill()
  assert.equal(client.alive, false)
  await assert.rejects(client.request('ping', {}, 20_000), /not running/)
})

test('client rejects a request when the process dies mid-flight', async () => {
  const client = stubClient()
  await client.start()
  const pending = client.request('hang', {}, 20_000)
  client.child.kill()
  await assert.rejects(pending, /sidecar/)
  await client.kill()
})

test('client rejects pending requests when the stdin stream errors', async () => {
  const client = stubClient()
  await client.start()
  const pending = client.request('hang', {}, 20_000)
  client.child.stdin.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))
  await assert.rejects(pending, /stdin failed/)
  await client.kill()
})


test('failed process startup rejects without hanging teardown', async () => {
  const client = stubClient()
  client.python = 'dsh-browser-use-missing-executable'
  await assert.rejects(client.start(), /ENOENT/)
  await client.kill()
})
