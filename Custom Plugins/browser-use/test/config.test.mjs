import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { normalizeConfig, vendoredBrowserUseVersion, createRuntime } from '../index.js'

test('config defaults apply and the endpoint is normalized to 127.0.0.1', () => {
  const config = normalizeConfig({})
  assert.equal(config.chromeEndpoint, 'http://127.0.0.1:9222')
  assert.equal(config.headless, false)
  assert.equal(config.maxSteps, 25)
  assert.equal(config.llmProvider, 'deepseek')
  assert.equal(config.llmModel, 'deepseek-chat')
  assert.equal(config.llmApiKeyEnv, 'DEEPSEEK_API_KEY')
  assert.equal(config.useVision, false)
  assert.equal(config.artifactDir, '.dsh/browser-use-artifacts')
})

test('empty chromeEndpoint selects the self-launched browser', () => {
  const config = normalizeConfig({ chromeEndpoint: '' })
  assert.equal(config.chromeEndpoint, '')
})

test('chromeEndpoint must be an HTTP loopback origin with an explicit port', () => {
  for (const bad of ['https://127.0.0.1:9222', 'http://localhost', 'http://example.com:9222', 'http://127.0.0.1:9222/path', 'not a url', 'http://user:pass@127.0.0.1:9222']) {
    assert.throws(() => normalizeConfig({ chromeEndpoint: bad }), /chromeEndpoint/)
  }
})

test('llm fields validate', () => {
  assert.throws(() => normalizeConfig({ llmProvider: 'anthropic' }), /llmProvider/)
  assert.throws(() => normalizeConfig({ llmModel: '' }), /llmModel/)
  assert.throws(() => normalizeConfig({ llmApiKeyEnv: '9bad' }), /llmApiKeyEnv/)
  assert.throws(() => normalizeConfig({ llmBaseUrl: 'ftp://x' }), /llmBaseUrl/)
  assert.equal(normalizeConfig({ llmProvider: 'openai', llmModel: 'gpt-x', llmBaseUrl: 'http://127.0.0.1:8080/v1' }).llmModel, 'gpt-x')
})

test('numeric and boolean fields validate', () => {
  for (const key of ['maxSteps', 'maxHistoryChars', 'setupTimeoutMs', 'startTimeoutMs', 'requestTimeoutMs', 'shortRequestTimeoutMs', 'chromeConnectTimeoutMs']) {
    assert.throws(() => normalizeConfig({ [key]: 0 }), new RegExp(key))
    assert.throws(() => normalizeConfig({ [key]: 1.5 }), new RegExp(key))
  }
  assert.throws(() => normalizeConfig({ headless: 'yes' }), /headless/)
  assert.throws(() => normalizeConfig({ useVision: 1 }), /useVision/)
  assert.equal(normalizeConfig({ artifactDir: '' }).artifactDir, '.dsh/browser-use-artifacts')
})

test('chrome launch fields validate like the browser-control bundle', () => {
  assert.throws(() => normalizeConfig({ chromeUserDataDir: '' }), /chromeUserDataDir/)
  assert.throws(() => normalizeConfig({ chromeExecutablePath: 'chrome.exe' }), /chromeExecutablePath/)
  assert.throws(() => normalizeConfig({ pythonExecutable: '' }), /pythonExecutable/)
  assert.throws(() => normalizeConfig({ venvRoot: ' ' }), /venvRoot/)
})

test('vendored browser-use version is read from the vendored pyproject', () => {
  assert.match(vendoredBrowserUseVersion(), /^\d+\.\d+\.\d+$/)
})

test('unknown or non-object config rejects at load', () => {
  assert.throws(() => normalizeConfig({ maxStep: 5 }), /unknown browser-use config field: maxStep/)
  assert.throws(() => normalizeConfig([1, 2]), /config must be an object/)
  assert.throws(() => normalizeConfig(null), /config must be an object/)
})

test('runtime ensure skips the build when the marker matches the vendored version', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bu-config-'))
  try {
    const config = normalizeConfig({ venvRoot: root })
    const pythonBin = process.platform === 'win32'
      ? join(root, 'venv', 'Scripts', 'python.exe')
      : join(root, 'venv', 'bin', 'python')
    mkdirSync(dirname(pythonBin), { recursive: true })
    writeFileSync(pythonBin, '')
    writeFileSync(join(root, 'venv', '.ready'), `browser-use ${vendoredBrowserUseVersion()}\n`)
    let runCalls = 0
    const ensure = createRuntime(config, async () => { runCalls += 1; throw new Error('must not spawn') })
    assert.equal(await ensure(), pythonBin)
    assert.equal(runCalls, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runtime ensure builds in staging, publishes, and cleans up behind itself', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bu-build-'))
  try {
    const config = normalizeConfig({ venvRoot: root })
    const calls = []
    const ensure = createRuntime(config, async (command, args) => {
      calls.push(args.join(' '))
      if (args[0] === '-c') return '314'
      // Emulate a real venv build: create the staging layout the later steps expect.
      const stagingIndex = args.findIndex(value => /^staging-/.test(basename(String(value))))
      if (args[0] === '-m' && stagingIndex !== -1) {
        const staging = String(args[stagingIndex])
        const binDir = process.platform === 'win32' ? join(staging, 'Scripts') : join(staging, 'bin')
        const executable = process.platform === 'win32' ? 'python.exe' : 'python'
        mkdirSync(binDir, { recursive: true })
        writeFileSync(join(binDir, executable), '')
      }
      return ''
    })
    const concurrentEnsure = createRuntime(config, async () => { throw new Error("concurrent installer must reuse published runtime") })
    const firstPromise = ensure()
    while (!existsSync(join(root, "setup.lock"))) await new Promise(resolve => setImmediate(resolve))
    const [first, second] = await Promise.all([firstPromise, concurrentEnsure()])
    assert.equal(first, second)
    assert.equal(calls.filter(call => call.includes('version_info')).length, 1)
    assert.ok(calls.some(call => call.includes('-m venv')))
    assert.ok(calls.some(call => call.includes('-m pip install')))
    assert.ok(calls.some(call => includesVendoredDir(call)))
    // The published venv carries the marker and no staging or retired directories remain.
    assert.equal(readFileSync(join(root, 'venv', '.ready'), 'utf8').trim(), `browser-use ${vendoredBrowserUseVersion()}`)
    assert.deepEqual(readdirSync(root).filter(name => /^(staging|retired)-/.test(name)), [])
    // A follow-up call finds the fresh marker and does not build again.
    const before = calls.length
    await ensure()
    assert.equal(calls.length, before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runtime ensure fails loudly when no Python >= 3.11 is found', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bu-nopy-'))
  try {
    const config = normalizeConfig({ venvRoot: root, pythonExecutable: 'definitely-not-a-python' })
    const ensure = createRuntime(config, async () => { throw new Error('spawn failed') })
    await assert.rejects(ensure(), /Python >= 3.11/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function includesVendoredDir(call) {
  return call.includes('vendor') && call.includes('browser-use')
}


test('independent Harness processes serialize installation in a shared venv root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bu-processes-'))
  try {
    const script = fileURLToPath(new URL('./fixtures/runtime-installer.mjs', import.meta.url))
    const run = promisify(execFile)
    const results = await Promise.allSettled([1, 2].map(() => run(process.execPath, [script, root], { windowsHide: true, timeout: 20000 })))
    for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.message)
    assert.equal(readFileSync(join(root, 'installers'), 'utf8').trim().split('\n').length, 1)
    assert.equal(existsSync(join(root, 'setup.lock')), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('an occupied setup lock fails within the configured wait without removing another owner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bu-lock-'))
  try {
    mkdirSync(join(root, 'setup.lock'))
    const ensure = createRuntime(normalizeConfig({ venvRoot: root, setupTimeoutMs: 10 }), async () => {
      throw new Error('must not build while another installer owns the lock')
    })
    await assert.rejects(ensure(), /setup lock timed out/)
    assert.equal(existsSync(join(root, 'setup.lock')), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
