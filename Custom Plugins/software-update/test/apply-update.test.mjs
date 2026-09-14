/**
 * The update helper performs a complete update against a real repository:
 * it stops the recorded server process, sets local work aside, moves the
 * checkout to the fetched commit, runs the refresh pipeline, puts the work
 * back, and starts a replacement server.
 *
 * A failure anywhere after the checkout moved returns the checkout to the
 * commit it started from and still starts a server, because an update that
 * leaves the machine with nothing listening is worse than one that did not
 * happen.
 *
 * The pipeline runs through a stand-in package manager so no real install or
 * build is executed, and the "server" is a throwaway listener whose readiness
 * the helper polls exactly as it polls a real one.
 */
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const HELPER = fileURLToPath(new URL('../scripts/apply-update.mjs', import.meta.url))
const AUTHOR = ['-c', 'user.name=test', '-c', 'user.email=test@example.com']

let sandbox
const started = new Set()

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'dsh-apply-update-'))
  process.env.GIT_CEILING_DIRECTORIES = sandbox
})

after(async () => {
  for (const pid of started) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // The process already exited on its own; nothing to clean up.
    }
  }
  // A relaunched server is started with the checkout as its working directory,
  // so Windows refuses to remove that directory until the process is gone.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const alive = [...started].filter((pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    })
    if (alive.length === 0) break
    await new Promise((resolve) => { setTimeout(resolve, 100) })
  }
  if (sandbox !== undefined) await rm(sandbox, { recursive: true, force: true, maxRetries: 10 })
})

/** Run a command and resolve with its outcome instead of throwing. */
function run(command, args, cwd, options = {}) {
  return new Promise((settle) => {
    execFile(command, args, {
      cwd, encoding: 'utf8', windowsHide: true, timeout: 120_000, ...options,
    }, (error, stdout, stderr) => {
      settle({ ok: error === null, code: error?.code ?? 0, stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })
}

/** Reserve a port and release it, so the relaunched listener can bind it. */
function freePort() {
  return new Promise((settle) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => { settle(port) })
    })
  })
}

/** Start a process that stays alive until it is signalled or killed. */
function idleProcess() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: false, stdio: 'ignore', windowsHide: true,
  })
  // The runner must never wait on a stand-in server: the helper is what owns
  // its lifetime, and the cleanup below is only a backstop.
  child.unref()
  started.add(child.pid)
  return child
}

/**
 * Build a checkout with one commit on origin that it lacks, a stand-in package
 * manager, and a replacement-server script the helper can launch.
 */
async function makeScenario({ pipelineFails = false } = {}) {
  const root = await mkdtemp(join(sandbox, 'case-'))
  const origin = join(root, 'origin.git')
  const work = join(root, 'work')
  const other = join(root, 'other')
  const state = join(root, 'state')
  await mkdir(state, { recursive: true })
  await run('git', ['-c', 'init.defaultBranch=main', 'init', '--bare', origin], root)
  await run('git', ['-c', 'init.defaultBranch=main', 'init', work], root)
  await writeFile(join(work, 'a.txt'), 'one\n')
  await writeFile(join(work, 'b.txt'), 'local base\n')
  await run('git', AUTHOR.concat(['add', '.']), work)
  await run('git', AUTHOR.concat(['commit', '-m', 'first']), work)
  await run('git', ['remote', 'add', 'origin', origin], work)
  await run('git', ['push', '-u', 'origin', 'main'], work)
  await run('git', ['clone', origin, other], root)
  await writeFile(join(other, 'a.txt'), 'two\n')
  await run('git', AUTHOR.concat(['commit', '-am', 'incoming commit']), other)
  await run('git', ['push', 'origin', 'main'], other)

  const pipelineLog = join(root, 'pipeline.log')
  const packageManager = join(root, 'fake-pnpm.mjs')
  await writeFile(packageManager, [
    "import { appendFileSync } from 'node:fs'",
    `appendFileSync(${JSON.stringify(pipelineLog)}, process.argv.slice(2).join(' ') + '\\n')`,
    ...pipelineFails ? ['process.exit(1)'] : [],
  ].join('\n'))

  const relaunchPidFile = join(root, 'relaunched.pid')
  const relaunchScript = join(root, 'relaunch.mjs')
  const port = await freePort()
  await writeFile(relaunchScript, [
    "import { createServer } from 'node:http'",
    "import { writeFileSync } from 'node:fs'",
    `writeFileSync(${JSON.stringify(relaunchPidFile)}, String(process.pid))`,
    `createServer((_, res) => { res.end('ok') }).listen(${String(port)}, '127.0.0.1')`,
    // Detached and out of the test's control once started, so it retires
    // itself well after the helper's readiness poll has seen it.
    'setTimeout(() => { process.exit(0) }, 30000)',
  ].join('\n'))

  return { root, work, state, pipelineLog, packageManager, relaunchScript, relaunchPidFile, port }
}

/** Write the request the plugin would have written, then run the helper. */
async function runHelper(scenario, { serverPid, gracefulStopMs = 1_000, host = '127.0.0.1' }) {
  const fromSha = (await run('git', ['rev-parse', 'HEAD'], scenario.work)).stdout.trim()
  await writeFile(join(scenario.state, 'request.json'), JSON.stringify({
    version: 1,
    startedAt: new Date().toISOString(),
    checkout: scenario.work,
    remote: 'origin',
    branch: 'main',
    previousBranch: 'main',
    fromSha,
    toSha: null,
    serverPid,
    gracefulStopMs,
    relaunchTimeoutMs: 60_000,
    buildTimeoutMs: 60_000,
    buildCommands: [['install'], ['run', 'build']],
    host,
    port: scenario.port,
    relaunch: { command: process.execPath, args: [scenario.relaunchScript], cwd: scenario.work },
  }, null, 2))
  const result = await run(process.execPath, [HELPER, '--state-dir', scenario.state], scenario.work, {
    env: { ...process.env, npm_execpath: scenario.packageManager },
  })
  const record = JSON.parse(await readFile(join(scenario.state, 'update.json'), 'utf8'))
  // The helper starts its replacement detached, so the test owns killing it.
  if (record.state !== null && record.step !== 'starting' && existsSync(scenario.relaunchPidFile)) {
    started.add(Number.parseInt(await readFile(scenario.relaunchPidFile, 'utf8'), 10))
  }
  return { result, record, fromSha }
}

/** Wait for a file written by a detached child, then remember its pid for cleanup. */
async function awaitPidFile(path) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) {
      const pid = Number.parseInt(await readFile(path, 'utf8'), 10)
      if (Number.isInteger(pid)) {
        started.add(pid)
        return pid
      }
    }
    await new Promise((resolve) => { setTimeout(resolve, 100) })
  }
  throw new Error(`${path} was never written`)
}

test('a complete update pulls, rebuilds, restores local work, and restarts the server', async () => {
  const scenario = await makeScenario()
  await writeFile(join(scenario.work, 'b.txt'), 'local edit\n')
  await writeFile(join(scenario.work, 'untracked.txt'), 'scratch\n')
  const server = idleProcess()
  server.kill()

  const { result, record } = await runHelper(scenario, { serverPid: server.pid })

  assert.equal(result.code, 0)
  assert.equal(record.state, 'done')
  assert.equal(record.step, 'complete')
  assert.equal(record.stashKept, false)

  // The checkout is at the incoming commit...
  const head = await run('git', ['rev-parse', 'HEAD'], scenario.work)
  const remote = await run('git', ['rev-parse', 'refs/remotes/origin/main'], scenario.work)
  assert.equal(head.stdout.trim(), remote.stdout.trim())
  assert.equal((await readFile(join(scenario.work, 'a.txt'), 'utf8')).trim(), 'two')

  // ...the local work came back...
  assert.equal((await readFile(join(scenario.work, 'b.txt'), 'utf8')).trim(), 'local edit')
  assert.equal((await readFile(join(scenario.work, 'untracked.txt'), 'utf8')).trim(), 'scratch')

  // ...the refresh pipeline ran through the launcher's package manager...
  const pipeline = await readFile(scenario.pipelineLog, 'utf8')
  assert.equal(pipeline.includes('install'), true)
  assert.equal(pipeline.includes('run build'), true)

  // ...and a replacement server answered on the recorded address.
  await awaitPidFile(scenario.relaunchPidFile)
})

test('the helper stops a server that will not exit on its own', async () => {
  const scenario = await makeScenario()
  const server = idleProcess()

  const { result, record } = await runHelper(scenario, { serverPid: server.pid, gracefulStopMs: 700 })

  assert.equal(result.code, 0)
  assert.equal(record.state, 'done')
  const log = await readFile(join(scenario.state, 'update.log'), 'utf8')
  assert.equal(log.includes('terminating'), true)
  assert.throws(() => { process.kill(server.pid, 0) })
})

test('a failed build returns the checkout and starts the previous server again', async () => {
  const scenario = await makeScenario({ pipelineFails: true })
  const outcome = await runHelper(scenario, { serverPid: 0 })

  assert.equal(outcome.result.code, 1)
  assert.equal(outcome.record.state, 'failed')
  // The stand-in package manager fails on its first invocation, so the update
  // stops at the first pipeline command and never reaches the second.
  assert.equal(outcome.record.step, 'build: install')
  assert.equal(outcome.record.finishedAt === null, false)

  // The checkout is back where it started, so the user keeps working code.
  const head = await run('git', ['rev-parse', 'HEAD'], scenario.work)
  assert.equal(head.stdout.trim(), outcome.fromSha)
  assert.equal((await readFile(join(scenario.work, 'a.txt'), 'utf8')).trim(), 'one')

  // And something is listening again, even though the update failed.
  await awaitPidFile(scenario.relaunchPidFile)
})

test('local work that cannot be restored is kept in the stash and reported', async () => {
  const scenario = await makeScenario()
  // The incoming commit rewrites a.txt, so a local edit to the same lines
  // cannot be replayed on top of it.
  await writeFile(join(scenario.work, 'a.txt'), 'conflicting local edit\n')

  const { result, record } = await runHelper(scenario, { serverPid: 0 })

  const log = await readFile(join(scenario.state, 'update.log'), 'utf8')
  assert.equal(result.code, 0)
  assert.equal(record.state, 'done', `the update should still succeed; log:\n${log}`)
  assert.equal(record.stashKept, true, `stash was not kept; log:\n${log}`)
  assert.match(String(record.message), /stash/u)
  assert.match(log, /git stash pop -> 1/u)
  const stash = await run('git', ['stash', 'list'], scenario.work)
  assert.match(stash.stdout, /dsh software update/u)
})
