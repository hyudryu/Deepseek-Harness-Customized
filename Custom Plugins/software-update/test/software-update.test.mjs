/**
 * The software-update plugin reports how a checkout compares with a remote
 * branch and starts an update only when one exists.
 *
 * Every fixture is a real git repository under a temporary directory with a
 * local bare "origin", so the probes run the same commands they run in
 * production without touching the network or the developer's own checkout.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, test } from 'node:test'
import { apply, normalizeConfig, __test } from '../index.js'
import { fetchBranch, readCheckoutStatus } from '../src/update/git.js'
import { isReplayableLaunch, normalizeUpdateRecord, statePaths } from '../src/update/records.js'

const { normalizeUpdateRecord: normalizeRecord } = __test

let sandbox
let home

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'dsh-software-update-'))
  // The OS temporary directory sits inside a developer's own checkout on some
  // machines, which would make every fixture resolve to that repository. The
  // ceiling keeps git's search for an enclosing repository inside the sandbox.
  process.env.GIT_CEILING_DIRECTORIES = sandbox
})

after(async () => {
  if (sandbox !== undefined) await rm(sandbox, { recursive: true, force: true })
})

beforeEach(async () => {
  home = await mkdtemp(join(sandbox, 'home-'))
  process.env.DSH_HOME = home
})

/** Run a command and resolve with its outcome instead of throwing. */
function run(command, args, cwd) {
  return new Promise((settle) => {
    execFile(command, args, { cwd, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      settle({ ok: error === null, code: error?.code ?? 0, stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })
}

const AUTHOR = ['-c', 'user.name=test', '-c', 'user.email=test@example.com']

/**
 * Build a checkout whose origin has one commit this checkout lacks.
 * @returns the repository paths and the subject of the missing commit.
 */
async function makeCheckout() {
  const root = await mkdtemp(join(sandbox, 'repo-'))
  const origin = join(root, 'origin.git')
  const work = join(root, 'work')
  const other = join(root, 'other')
  await run('git', ['-c', 'init.defaultBranch=main', 'init', '--bare', origin], root)
  await run('git', ['-c', 'init.defaultBranch=main', 'init', work], root)
  await writeFile(join(work, 'a.txt'), 'one\n')
  await run('git', AUTHOR.concat(['add', '.']), work)
  await run('git', AUTHOR.concat(['commit', '-m', 'first']), work)
  await run('git', ['remote', 'add', 'origin', origin], work)
  await run('git', ['push', '-u', 'origin', 'main'], work)
  await run('git', ['clone', origin, other], root)
  await writeFile(join(other, 'a.txt'), 'two\n')
  await run('git', AUTHOR.concat(['commit', '-am', 'second commit']), other)
  await run('git', ['push', 'origin', 'main'], other)
  return { root, origin, work, other }
}

/** Minimal Cordis double recording the route the plugin registers. */
function createCtx({ rejection } = {}) {
  const routes = []
  const warnings = []
  const ctx = {
    logger: { warn: message => { warnings.push(message) } },
    webServer: {
      host: '127.0.0.1',
      port: 3080,
      register: (route) => { routes.push(route); return () => {} },
    },
    connection: { requestRejection: () => rejection },
    get: () => undefined,
    effect: (fn) => { fn(); return () => {} },
  }
  return { ctx, routes, warnings }
}

/** One request/response double recording the handler's answer. */
function httpDouble({ method = 'GET', url = '/software-update' } = {}) {
  const recorded = { status: undefined, body: undefined, headers: undefined }
  const request = { method, url, headers: {}, socket: {} }
  const response = {
    writeHead(status, headers) { recorded.status = status; recorded.headers = headers },
    end(body, callback) {
      recorded.body = body
      if (typeof callback === 'function') callback()
    },
    setHeader() {},
  }
  return { request, response, recorded }
}

const statusOf = (recorded) => JSON.parse(recorded.body)

test('configuration defaults to the fork update pipeline and fails loud on a bad value', () => {
  const config = normalizeConfig({})
  assert.equal(config.remote, 'origin')
  assert.equal(config.branch, 'main')
  assert.deepEqual(config.buildCommands, [['install'], ['run', 'install:custom-plugins'], ['run', 'build']])
  assert.throws(() => normalizeConfig({ fetchTtlMs: 0 }), /positive integer/u)
  assert.throws(() => normalizeConfig({ branch: '-oops' }), /git branch name/u)
  assert.throws(() => normalizeConfig({ remote: 'origin main' }), /git remote name/u)
  assert.throws(() => normalizeConfig({ buildCommands: [] }), /non-empty list/u)
  assert.deepEqual(normalizeConfig({ buildCommands: [['ci']] }).buildCommands, [['ci']])
})

test('an update record is projected onto the fields the browser may read', () => {
  assert.equal(normalizeRecord(null), null)
  assert.equal(normalizeRecord([1, 2]), null)
  const record = normalizeRecord({
    state: 'done', startedAt: 'now', finishedAt: '', toSha: 'abc', stashKept: 'yes', extra: 'dropped',
  })
  assert.equal(record.state, 'done')
  assert.equal(record.startedAt, 'now')
  assert.equal(record.finishedAt, null)
  assert.equal(record.toSha, 'abc')
  assert.equal(record.stashKept, false)
  assert.equal('extra' in record, false)
  assert.equal(normalizeRecord({ state: 'forged' }).state, 'unknown')
})

test('a launch record is replayable only with an executable and an entry module', () => {
  assert.equal(isReplayableLaunch({ execPath: 'node', argv: ['x.js'], execArgv: [], cwd: '/tmp' }), true)
  assert.equal(isReplayableLaunch({ execPath: '', argv: ['x.js'], execArgv: [], cwd: '/tmp' }), false)
  assert.equal(isReplayableLaunch({ execPath: 'node', argv: [], execArgv: [], cwd: '/tmp' }), false)
  assert.equal(isReplayableLaunch({ execPath: 'node', argv: [1], execArgv: [], cwd: '/tmp' }), false)
  assert.equal(isReplayableLaunch(null), false)
})

test('a checkout behind its origin reports the commits, the branch, and the local changes', async () => {
  const { work } = await makeCheckout()
  await writeFile(join(work, 'uncommitted.txt'), 'draft\n')
  await writeFile(join(work, 'a.txt'), 'edited\n')

  const fetched = await fetchBranch({ checkout: work, remote: 'origin', branch: 'main', timeoutMs: 30_000 })
  assert.equal(fetched.ok, true)

  const status = await readCheckoutStatus({
    checkout: work, remote: 'origin', branch: 'main', timeoutMs: 30_000, commitLimit: 20,
  })
  assert.equal(status.state, 'behind')
  assert.equal(status.behind, 1)
  assert.equal(status.commits.length, 1)
  assert.equal(status.commits[0].subject, 'second commit')
  assert.equal(status.currentBranch, 'main')
  assert.equal(status.changes, 2)
  assert.equal(status.localSha === status.remoteSha, false)
})

test('a checkout level with its origin reports no update', async () => {
  const { work } = await makeCheckout()
  await run('git', ['pull', '--ff-only', 'origin', 'main'], work)
  const status = await readCheckoutStatus({
    checkout: work, remote: 'origin', branch: 'main', timeoutMs: 30_000, commitLimit: 20,
  })
  assert.equal(status.state, 'current')
  assert.equal(status.behind, 0)
  assert.deepEqual(status.commits, [])
})

test('a directory that is not a repository reports unknown instead of throwing', async () => {
  const plain = await mkdtemp(join(sandbox, 'plain-'))
  const status = await readCheckoutStatus({
    checkout: plain, remote: 'origin', branch: 'main', timeoutMs: 30_000, commitLimit: 20,
  })
  assert.equal(status.state, 'unknown')
  assert.equal(status.reason, 'not-a-repository')
})

test('a missing remote branch reports unknown with its own reason', async () => {
  const { work } = await makeCheckout()
  const status = await readCheckoutStatus({
    checkout: work, remote: 'origin', branch: 'release', timeoutMs: 30_000, commitLimit: 20,
  })
  assert.equal(status.state, 'unknown')
  assert.equal(status.reason, 'remote-branch-missing')
})

test('fetching an unreachable remote reports one line of cause without throwing', async () => {
  const { work } = await makeCheckout()
  const fetched = await fetchBranch({ checkout: work, remote: 'missing', branch: 'main', timeoutMs: 30_000 })
  assert.equal(fetched.ok, false)
  assert.equal(typeof fetched.message, 'string')
  assert.notEqual(fetched.message, '')
})

test('the status route reports the comparison and refuses an unauthenticated caller', async (t) => {
  const { work } = await makeCheckout()
  const config = { checkout: work, remote: 'origin', branch: 'main', fetchTtlMs: 1, commandTimeoutMs: 30_000 }
  const { ctx, routes } = createCtx()
  apply(ctx, config)
  const route = routes.at(0)
  assert.equal(route.path, '/software-update')

  await t.test('GET answers with the update the checkout is missing', async () => {
    const { request, response, recorded } = httpDouble()
    await route.handler(request, response)
    assert.equal(recorded.status, 200)
    assert.equal(recorded.headers['cache-control'], 'no-store')
    const body = statusOf(recorded)
    assert.equal(body.ok, true)
    assert.equal(body.state, 'behind')
    assert.equal(body.behind, 1)
    assert.equal(body.branch, 'main')
    assert.equal(body.canUpdate, true)
    assert.equal(body.update, null)
  })

  await t.test('an unauthenticated caller is refused before any git command runs', async () => {
    const denied = createCtx({ rejection: 401 })
    apply(denied.ctx, config)
    const { request, response, recorded } = httpDouble()
    await denied.routes.at(0).handler(request, response)
    assert.equal(recorded.status, 401)
    assert.equal(statusOf(recorded).error, 'unauthorized')
  })

  await t.test('an unsupported verb is rejected', async () => {
    const { request, response, recorded } = httpDouble({ method: 'DELETE' })
    await route.handler(request, response)
    assert.equal(recorded.status, 405)
  })

  await t.test('POST without an available update changes nothing', async () => {
    const upToDate = await makeCheckout()
    await run('git', ['pull', '--ff-only', 'origin', 'main'], upToDate.work)
    const current = createCtx()
    apply(current.ctx, { ...config, checkout: upToDate.work, fetchTtlMs: 1 })
    const { request, response, recorded } = httpDouble({ method: 'POST' })
    await current.routes.at(0).handler(request, response)
    assert.equal(recorded.status, 409)
    assert.equal(statusOf(recorded).error, 'no-update')
  })
})

test('the status route reports a checkout it cannot update', async () => {
  const plain = await mkdtemp(join(sandbox, 'plain-route-'))
  const { ctx, routes } = createCtx()
  apply(ctx, { checkout: plain, remote: 'origin', branch: 'main', fetchTtlMs: 1, commandTimeoutMs: 30_000 })
  const { request, response, recorded } = httpDouble()
  await routes.at(0).handler(request, response)
  assert.equal(recorded.status, 200)
  const body = statusOf(recorded)
  assert.equal(body.state, 'unknown')
  assert.equal(body.canUpdate, false)
})

test('the plugin keeps its state outside the checkout it updates', async () => {
  const paths = statePaths(join(home, 'software-update'))
  assert.equal(paths.dir.startsWith(home), true)
  assert.equal(paths.launch.endsWith('launch.json'), true)
  assert.equal(paths.request.endsWith('request.json'), true)
  assert.equal(paths.update.endsWith('update.json'), true)
})
