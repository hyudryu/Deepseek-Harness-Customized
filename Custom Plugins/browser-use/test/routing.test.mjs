import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, buildSidecarEnv, normalizeConfig } from '../index.js'

function harness(options = {}) {
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'dsh-bu-route-'))
  const registrations = { tools: [], skills: [] }
  const disposals = []
  const launched = []
  const clients = []
  const ctx = {
    logger: { warn() {}, debug() {} },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposals.push(dispose)
    },
    provide() {},
    skills: {
      register(value) { registrations.skills.push(value) },
    },
    tools: {
      register(value) { registrations.tools.push(value) },
    },
  }
  const deps = {
    ensureRuntime: async () => '/stub/python',
    launchSidecar: async exec => {
      const client = {
        alive: true,
        killed: false,
        requests: [],
        cwd: exec?.agent?.session?.header?.cwd,
        async request(method, params, timeoutMs) {
          this.requests.push({ method, params, timeoutMs })
          if (method === 'run') {
            return {
              done: true,
              final_result: 'stub final',
              errors: [],
              steps: [],
              url: 'https://example.com/',
              elapsed_s: 1,
              screenshot_path: join(root, 'shot.png'),
            }
          }
          if (method === 'screenshot') {
            return { screenshot_path: params.path ?? join(root, 'shot.png'), url: 'https://example.com/', title: 'Example' }
          }
          return { stopped: true }
        },
        async kill() { this.killed = true; this.alive = false },
      }
      clients.push(client)
      launched.push(exec)
      return client
    },
  }
  apply(ctx, { chromeEndpoint: '', artifactDir: join(root, 'artifacts') }, deps)
  return { root, registrations, disposals, launched, clients, tool: registrations.tools[0] }
}

function execFor(root, id = 'session-1') {
  return { agent: { session: { id, header: { cwd: root } } }, signal: { aborted: false } }
}

test('apply registers the tool and the skill with the browser-mode rule', () => {
  const { registrations, root } = harness()
  try {
    assert.equal(registrations.tools.length, 1)
    assert.equal(registrations.tools[0].name, 'browser_use')
    assert.equal(registrations.skills.length, 1)
    const skill = registrations.skills[0]
    assert.equal(skill.name, 'browser-use')
    assert.match(skill.description, /browser mode/i)
    assert.match(skill.content, /mandatory for web actions/i)
    assert.match(skill.content, /screenshot/i)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('run requires a task and forwards a bounded step budget', async () => {
  const { tool, clients, root } = harness()
  try {
    const exec = execFor(root)
    await assert.rejects(tool.execute({ action: 'run' }, exec), /task is required/)
    await tool.execute({ action: 'run', task: 'open example', max_steps: 999 }, exec)
    const run = clients[0].requests.find(request => request.method === 'run')
    assert.equal(run.params.task, 'open example')
    assert.equal(run.params.max_steps, 25)
    assert.equal(run.params.use_vision, false)
    const result = await tool.execute({ action: 'run', task: 'small', max_steps: 3 }, exec)
    assert.equal(result.ok, true)
    assert.equal(result.action, 'run')
    assert.ok(result.screenshot_path.endsWith('shot.png'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('run propagates sidecar errors and reuses one sidecar per session', async () => {
  const { tool, clients, root } = harness()
  try {
    const exec = execFor(root)
    await tool.execute({ action: 'run', task: 'a' }, exec)
    await tool.execute({ action: 'run', task: 'b' }, exec)
    assert.equal(clients.length, 1)
    const client = clients[0]
    client.request = async () => { throw new Error('sidecar exploded') }
    await assert.rejects(tool.execute({ action: 'run', task: 'c' }, exec), /sidecar exploded/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('screenshot resolves relative paths inside the artifact directory', async () => {
  const { tool, clients, root } = harness()
  try {
    const exec = execFor(root)
    await tool.execute({ action: 'screenshot', path: 'evidence.png' }, exec)
    const shot = clients[0].requests.find(request => request.method === 'screenshot')
    assert.equal(shot.params.path, join(root, 'artifacts', 'evidence.png'))
    assert.equal(shot.params.full_page, true)
    const result = await tool.execute({ action: 'screenshot' }, exec)
    assert.equal(result.ok, true)
    assert.equal(result.title, 'Example')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('stop without a sidecar reports stopped false and unknown actions reject', async () => {
  const { tool, root } = harness()
  try {
    const exec = execFor(root)
    assert.deepEqual(await tool.execute({ action: 'stop' }, exec), { ok: true, action: 'stop', stopped: false })
    await tool.execute({ action: 'run', task: 'x' }, exec)
    const stopped = await tool.execute({ action: 'stop' }, exec)
    assert.equal(stopped.stopped, true)
    await assert.rejects(tool.execute({ action: 'dance' }, exec), /unsupported browser_use action/)
    await assert.rejects(tool.execute({ action: 'run' }, { ...exec, signal: { aborted: true } }), /aborted/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('concurrent first calls share one sidecar launch', async () => {
  const { tool, clients, root } = harness()
  try {
    const exec = execFor(root)
    await Promise.all([
      tool.execute({ action: 'run', task: 'a' }, exec),
      tool.execute({ action: 'run', task: 'b' }, exec),
      tool.execute({ action: 'screenshot' }, exec),
    ])
    assert.equal(clients.length, 1)
    assert.equal(clients[0].requests.length, 3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a dead sidecar is replaced on the next call', async () => {
  const { tool, clients, root } = harness()
  try {
    const exec = execFor(root)
    await tool.execute({ action: 'run', task: 'a' }, exec)
    clients[0].alive = false
    await tool.execute({ action: 'run', task: 'b' }, exec)
    assert.equal(clients.length, 2)
    assert.equal(clients[0].killed, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sidecars are per-session and disposal kills them all', async () => {
  const { tool, clients, disposals, root } = harness()
  try {
    await tool.execute({ action: 'run', task: 'one' }, execFor(root, 'session-1'))
    await tool.execute({ action: 'run', task: 'two' }, execFor(root, 'session-2'))
    assert.equal(clients.length, 2)
    assert.equal(clients.every(client => !client.killed), true)
    for (const dispose of disposals) await dispose()
    assert.equal(clients.every(client => client.killed), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sidecar env carries config, the API key, and telemetry opt-out', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bu-env-'))
  try {
    process.env.DSH_BU_TEST_KEY = 'secret-value'
    const config = normalizeConfig({ chromeEndpoint: 'http://127.0.0.1:9222', llmApiKeyEnv: 'DSH_BU_TEST_KEY', llmBaseUrl: 'http://127.0.0.1:9000/v1' })
    const env = buildSidecarEnv(config, execFor(root))
    assert.equal(env.DSH_BU_CDP_URL, 'http://127.0.0.1:9222')
    assert.equal(env.DSH_BU_HEADLESS, 'false')
    assert.equal(env.DSH_BU_LLM_PROVIDER, 'deepseek')
    assert.equal(env.DSH_BU_LLM_MODEL, 'deepseek-chat')
    assert.equal(env.DSH_BU_LLM_BASE_URL, 'http://127.0.0.1:9000/v1')
    assert.equal(env.DSH_BU_API_KEY, 'secret-value')
    assert.equal(env.DSH_BU_MAX_STEPS, '25')
    assert.equal(env.ANONYMIZED_TELEMETRY, 'false')
    assert.equal(env.DSH_BU_ARTIFACT_DIR, join(root, '.dsh', 'browser-use-artifacts'))
  } finally {
    delete process.env.DSH_BU_TEST_KEY
    rmSync(root, { recursive: true, force: true })
  }
})

test('missing API key env yields an empty string, not undefined', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bu-nokey-'))
  try {
    const config = normalizeConfig({ llmApiKeyEnv: 'DSH_BU_KEY_THAT_IS_UNSET' })
    const env = buildSidecarEnv(config, execFor(root))
    assert.equal(env.DSH_BU_API_KEY, '')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
