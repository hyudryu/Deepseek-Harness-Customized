/**
 * The update stops the server on purpose, so turns that were in flight are
 * interrupted. The plugin is the only thing that knows the restart is coming:
 * it names those sessions immediately before the helper starts, and the
 * successor process continues them once startup is committed.
 *
 * These tests cover the record's own validation rules and the whole boot path —
 * a second process reading the first one's record and opening one continuation
 * turn in each named session.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, describe, test } from 'node:test'

import { apply, __test } from '../index.js'
import { checkoutKey } from '../src/update/home.js'
import {
  continuationMessage,
  continuationPrompt,
  normalizeResumeRecord,
  resumeRecord,
  resumeRecordApplies,
  runningRootSessions,
} from '../src/update/resume.js'

let home
let stateDir

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-resume-'))
  process.env.DSH_HOME = home
  // The plugin resolves its checkout from the server's working directory when
  // none is configured, and namespaces its state directory by that checkout.
  stateDir = join(home, 'software-update', checkoutKey(process.cwd()))
})

after(async () => {
  delete process.env.DSH_HOME
})

/** A live root agent as the registry reports it. */
function rootAgent(id, status, title) {
  return { id, status, session: { header: title === undefined ? {} : { title } } }
}

describe('the sessions an update captures', () => {
  test('only running roots are taken, with their titles', () => {
    const sessions = runningRootSessions({ roots: () => [
      rootAgent('running-one', 'running', 'First'),
      rootAgent('idle-one', 'idle', 'Second'),
      rootAgent('running-untitled', 'running'),
    ] })
    assert.deepEqual(sessions, [
      { id: 'running-one', title: 'First' },
      { id: 'running-untitled', title: null },
    ])
  })

  test('an absent, failing, or malformed registry reports nothing running', () => {
    assert.deepEqual(runningRootSessions(undefined), [])
    assert.deepEqual(runningRootSessions({}), [])
    assert.deepEqual(runningRootSessions({ roots: () => { throw new Error('no database') } }), [])
    assert.deepEqual(runningRootSessions({ roots: () => null }), [])
    // A root mid-teardown may already be missing its identity.
    assert.deepEqual(runningRootSessions({ roots: () => [rootAgent('', 'running')] }), [])
  })

  test('an empty set produces no record, so a quiet update writes no file', () => {
    assert.equal(resumeRecord([]), null)
    const record = resumeRecord([{ id: 'a', title: null }])
    assert.equal(record.version, 1)
    assert.equal(record.recorderPid, process.pid)
    assert.deepEqual(record.sessions, [{ id: 'a', title: null }])
  })

  test('a malformed record is refused rather than acted on', () => {
    assert.equal(normalizeResumeRecord(null), null)
    assert.equal(normalizeResumeRecord([]), null)
    assert.equal(normalizeResumeRecord({ version: 2, capturedAt: 'x', recorderPid: 1, sessions: [] }), null)
    assert.equal(normalizeResumeRecord({ version: 1, capturedAt: '', recorderPid: 1, sessions: [] }), null)
    assert.equal(normalizeResumeRecord({ version: 1, capturedAt: 'x', recorderPid: 'one', sessions: [] }), null)
    assert.equal(normalizeResumeRecord({ version: 1, capturedAt: 'x', recorderPid: 1, sessions: 'no' }), null)
  })

  test('a record keeps only usable, distinct session entries', () => {
    const record = normalizeResumeRecord({
      version: 1,
      capturedAt: '2026-01-01T00:00:00.000Z',
      recorderPid: 42,
      sessions: [
        { id: 'keep', title: 'Kept' },
        { id: 'keep', title: 'Duplicate' },
        { id: '' },
        { id: 'x'.repeat(500) },
        { id: 7 },
        null,
      ],
    })
    assert.deepEqual(record.sessions, [{ id: 'keep', title: 'Kept' }])
  })

  test('the record applies only to a different, recent process', () => {
    const record = normalizeResumeRecord({
      version: 1,
      capturedAt: '2026-01-01T00:00:00.000Z',
      recorderPid: 4242,
      sessions: [{ id: 's' }],
    })
    const at = Date.parse('2026-01-01T00:10:00.000Z')
    assert.equal(resumeRecordApplies(record, 3_600_000, at), true)
    // The writer is not its own successor.
    assert.equal(resumeRecordApplies({ ...record, recorderPid: process.pid }, 3_600_000, at), false)
    // Outside the window the update evidently never took the server down.
    assert.equal(resumeRecordApplies(record, 60_000, at), false)
    // A clock that moved backwards must not widen the window.
    assert.equal(resumeRecordApplies(record, 3_600_000, Date.parse('2025-12-31T23:59:30.000Z')), false)
    assert.equal(resumeRecordApplies({ ...record, sessions: [] }, 3_600_000, at), false)
    assert.equal(resumeRecordApplies({ ...record, capturedAt: 'not-a-date' }, 3_600_000, at), false)
    assert.equal(resumeRecordApplies(null, 3_600_000, at), false)
  })

  test('the continuation is a frozen user message from this plugin', () => {
    const message = continuationMessage('go on')
    assert.equal(Object.isFrozen(message), true)
    assert.equal(Object.isFrozen(message.content), true)
    assert.equal(Object.isFrozen(message.source), true)
    assert.equal(message.role, 'user')
    assert.equal(typeof message.id, 'string')
    assert.deepEqual(message.content, [{ type: 'text', text: 'go on' }])
    assert.equal(message.source.kind, 'plugin')
    assert.equal(message.source.plugin, 'software-update')
  })

  test('the prompt names the interrupted calls so they are not blindly repeated', () => {
    const prompt = continuationPrompt(
      { id: 's', title: 'Fix the parser' },
      'Continue the task.',
      { state: 'done', previousBranch: 'main', fromSha: 'a'.repeat(40), toSha: 'b'.repeat(40) },
    )
    assert.match(prompt, /Continue the task\./)
    assert.match(prompt, /main at a{12} became b{12}/u)
    assert.match(prompt, /Session: Fix the parser\./u)

    const bare = continuationPrompt({ id: 's', title: null }, 'Continue.', { state: 'done' })
    assert.match(bare, /the previous checkout at an unknown commit became an unknown commit/u)
    assert.equal(bare.includes('Session:'), false)
  })

  test('a rolled-back update is never described as applied', () => {
    // `toSha` is recorded before a rollback, so it names a revision that is no
    // longer checked out; telling the model it is running would be a lie.
    const rolledBack = continuationPrompt({ id: 's', title: null }, 'Continue.', {
      state: 'failed',
      previousBranch: 'main',
      fromSha: 'a'.repeat(40),
      toSha: 'b'.repeat(40),
    })
    assert.match(rolledBack, /failed and was rolled back/u)
    assert.match(rolledBack, /back at a{12}/u)
    assert.equal(rolledBack.includes(`became b`), false)

    const unknown = continuationPrompt({ id: 's', title: null }, 'Continue.', { state: null })
    assert.match(unknown, /outcome is unknown/u)
    assert.equal(unknown.includes('applied a software update'), false)
  })
})

/** A host context recording the routes it registered and the agents it resumed. */
function createCtx({ resolve, ready = true } = {}) {
  const ctx = {
    logger: { warn() {}, info() {} },
    effect(callback) {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    get(service) {
      if (service === 'agents') {
        return {
          get: () => undefined,
          roots: () => [],
          withoutInitiator: async (run) => run(),
        }
      }
      if (service === 'typert') {
        return { lookups: { get: key => (key === 'agent' ? { resolve } : undefined) } }
      }
      if (service === 'appReady') {
        // The launcher fires a listener immediately when startup already
        // committed, which is the case this plugin must handle.
        return { onReady: listener => { if (ready) listener(); return () => {} } }
      }
      return undefined
    },
    webServer: { host: '127.0.0.1', port: 3080, register: () => () => {} },
    connection: { requestRejection: () => undefined },
  }
  return { ctx }
}

/** Wait until a predicate holds, so a boot continuation can settle. */
async function until(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => { setTimeout(resolve, 10) })
  }
  throw new Error(`timed out waiting for ${label}`)
}

/** Write the record a server that died mid-update would have left behind. */
async function writeRecord(record) {
  await mkdir(stateDir, { recursive: true })
  await writeFile(join(stateDir, 'resume.json'), JSON.stringify(record, null, 2))
  await writeFile(join(stateDir, 'update.json'), JSON.stringify({
    state: 'done',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:05:00.000Z',
    fromSha: 'a'.repeat(40),
    toSha: 'b'.repeat(40),
    previousBranch: 'main',
    step: 'complete',
  }, null, 2))
}

describe('continuing the sessions an update interrupted', () => {
  test('the successor continues every recorded session and consumes the record', async () => {
    await writeRecord({
      version: 1,
      capturedAt: new Date().toISOString(),
      recorderPid: process.pid + 1,
      sessions: [{ id: 'session-one', title: 'One' }, { id: 'session-two', title: null }],
    })
    const followed = []
    const { ctx } = createCtx({ resolve: async (id) => ({ followup: message => followed.push({ id, message }) }) })
    apply(ctx, { resumeWindowMs: 3_600_000 })

    await until(() => followed.length === 2, 'both sessions to be continued')
    assert.deepEqual(followed.map(entry => entry.id).sort(), ['session-one', 'session-two'])
    assert.equal(followed[0].message.source.plugin, 'software-update')
    assert.match(followed[0].message.content[0].text, /software update/u)
    await until(() => !existsSync(join(stateDir, 'resume.json')), 'the record to be consumed')
  })

  test('a record this same process wrote is not acted on', async () => {
    await writeRecord({
      version: 1,
      capturedAt: new Date().toISOString(),
      recorderPid: process.pid,
      sessions: [{ id: 'session-one', title: null }],
    })
    const followed = []
    const { ctx } = createCtx({ resolve: async () => ({ followup: m => followed.push(m) }) })
    apply(ctx, {})
    await until(() => !existsSync(join(stateDir, 'resume.json')), 'the record to be discarded')
    assert.deepEqual(followed, [])
  })

  test('a record older than the window is discarded without resuming anything', async () => {
    await writeRecord({
      version: 1,
      capturedAt: new Date(Date.now() - 86_400_000).toISOString(),
      recorderPid: process.pid + 1,
      sessions: [{ id: 'session-one', title: null }],
    })
    const followed = []
    const { ctx } = createCtx({ resolve: async () => ({ followup: m => followed.push(m) }) })
    apply(ctx, { resumeWindowMs: 60_000 })
    await until(() => !existsSync(join(stateDir, 'resume.json')), 'the stale record to be discarded')
    assert.deepEqual(followed, [])
  })

  test('resumeOnRestart false leaves the record alone and resumes nothing', async () => {
    await writeRecord({
      version: 1,
      capturedAt: new Date().toISOString(),
      recorderPid: process.pid + 1,
      sessions: [{ id: 'session-one', title: null }],
    })
    const followed = []
    const { ctx } = createCtx({ resolve: async () => ({ followup: m => followed.push(m) }) })
    apply(ctx, { resumeOnRestart: false })
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    assert.deepEqual(followed, [])
    assert.equal(existsSync(join(stateDir, 'resume.json')), true)
  })

  test('a session that cannot be resumed does not stop the others', async () => {
    await writeRecord({
      version: 1,
      capturedAt: new Date().toISOString(),
      recorderPid: process.pid + 1,
      sessions: [{ id: 'broken', title: null }, { id: 'fine', title: null }],
    })
    const followed = []
    const { ctx } = createCtx({
      resolve: async (id) => {
        if (id === 'broken') throw new Error('session not found')
        return { followup: m => followed.push({ id, m }) }
      },
    })
    apply(ctx, {})
    await until(() => followed.length === 1, 'the healthy session to be continued')
    assert.equal(followed[0].id, 'fine')
    await until(() => !existsSync(join(stateDir, 'resume.json')), 'the record to be consumed')
  })

  test('a session the lookup cannot resolve at all is skipped, not fatal', async () => {
    await writeRecord({
      version: 1,
      capturedAt: new Date().toISOString(),
      recorderPid: process.pid + 1,
      sessions: [{ id: 'gone', title: null }],
    })
    const { ctx } = createCtx({ resolve: async () => undefined })
    apply(ctx, {})
    await until(() => !existsSync(join(stateDir, 'resume.json')), 'the record to be consumed')
  })
})
