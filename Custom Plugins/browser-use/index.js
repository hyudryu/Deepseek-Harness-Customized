import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { connectChrome } from 'dsh-browser-control/chrome-backend.js'

export const name = 'browser-use'
export const inject = ['tools', 'skills']

const SKILL_CONTENT = readFileSync(new URL('./skills/browser-use.md', import.meta.url), 'utf8')
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const VENDOR_DIR = join(PLUGIN_DIR, 'vendor', 'browser-use')
const SIDECAR_PATH = join(PLUGIN_DIR, 'python', 'sidecar.py')
const MIN_PYTHON_VERSION = 311
const COMMAND_OUTPUT_TAIL = 2000

const DEFAULTS = Object.freeze({
  chromeEndpoint: 'http://127.0.0.1:9222',
  chromeConnectTimeoutMs: 10_000,
  chromeUserDataDir: join(homedir(), '.dsh', 'chrome-profile'),
  chromeExecutablePath: undefined,
  headless: false,
  pythonExecutable: undefined,
  venvRoot: join(homedir(), '.dsh', 'browser-use'),
  maxSteps: 25,
  llmProvider: 'deepseek',
  llmModel: 'deepseek-chat',
  llmBaseUrl: undefined,
  llmApiKeyEnv: 'DEEPSEEK_API_KEY',
  useVision: false,
  artifactDir: '.dsh/browser-use-artifacts',
  maxHistoryChars: 12_000,
  setupTimeoutMs: 600_000,
  startTimeoutMs: 120_000,
  requestTimeoutMs: 1_800_000,
  shortRequestTimeoutMs: 60_000,
})

function positiveInt(value, fallback, name) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function booleanOr(value, fallback, name) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`)
  return value
}

function nonemptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a nonempty string`)
  return value
}

/** Read the vendored browser-use version; the marker rebuilds the venv when it changes. */
export function vendoredBrowserUseVersion() {
  const pyproject = readFileSync(join(VENDOR_DIR, 'pyproject.toml'), 'utf8')
  const match = /^version = "(.+)"$/m.exec(pyproject)
  if (!match) throw new Error(`vendored browser-use pyproject.toml has no version: ${VENDOR_DIR}`)
  return match[1]
}

/** Normalize and validate the plugin config; invalid configuration fails at load. */
export function normalizeConfig(input = {}) {
  const endpointInput = input.chromeEndpoint ?? DEFAULTS.chromeEndpoint
  let chromeEndpoint = ''
  if (endpointInput !== '') {
    let endpoint
    try { endpoint = new URL(nonemptyString(endpointInput, 'chromeEndpoint')) }
    catch { throw new Error('chromeEndpoint must be a valid URL') }
    if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
      || !endpoint.port || Number(endpoint.port) <= 0 || endpoint.username || endpoint.password
      || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
      throw new Error('chromeEndpoint must be an HTTP loopback origin with an explicit port (or empty to let browser-use launch its own browser)')
    }
    if (endpoint.hostname === 'localhost') endpoint.hostname = '127.0.0.1'
    chromeEndpoint = endpoint.origin
  }
  if (input.chromeUserDataDir !== undefined && (typeof input.chromeUserDataDir !== 'string' || !input.chromeUserDataDir.trim())) {
    throw new Error('chromeUserDataDir must be a nonempty path')
  }
  if (input.chromeExecutablePath !== undefined && (typeof input.chromeExecutablePath !== 'string' || !isAbsolute(input.chromeExecutablePath))) {
    throw new Error('chromeExecutablePath must be an absolute executable path')
  }
  const llmProvider = input.llmProvider ?? DEFAULTS.llmProvider
  if (!['deepseek', 'openai'].includes(llmProvider)) throw new Error('llmProvider must be deepseek or openai')
  const llmApiKeyEnv = input.llmApiKeyEnv ?? DEFAULTS.llmApiKeyEnv
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(llmApiKeyEnv)) throw new Error('llmApiKeyEnv must be an environment variable name')
  if (input.llmBaseUrl !== undefined) {
    let baseUrl
    try { baseUrl = new URL(nonemptyString(input.llmBaseUrl, 'llmBaseUrl')) }
    catch { throw new Error('llmBaseUrl must be a valid URL') }
    if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('llmBaseUrl must use HTTP or HTTPS')
  }
  if (input.pythonExecutable !== undefined
    && (typeof input.pythonExecutable !== 'string' || !input.pythonExecutable.trim())) {
    throw new Error('pythonExecutable must be a nonempty command or path')
  }
  return {
    chromeEndpoint,
    chromeConnectTimeoutMs: positiveInt(input.chromeConnectTimeoutMs, DEFAULTS.chromeConnectTimeoutMs, 'chromeConnectTimeoutMs'),
    chromeUserDataDir: resolve(input.chromeUserDataDir ?? DEFAULTS.chromeUserDataDir),
    chromeExecutablePath: input.chromeExecutablePath,
    headless: booleanOr(input.headless, DEFAULTS.headless, 'headless'),
    pythonExecutable: input.pythonExecutable,
    venvRoot: resolve(nonemptyString(input.venvRoot ?? DEFAULTS.venvRoot, 'venvRoot')),
    maxSteps: positiveInt(input.maxSteps, DEFAULTS.maxSteps, 'maxSteps'),
    llmProvider,
    llmModel: nonemptyString(input.llmModel ?? DEFAULTS.llmModel, 'llmModel'),
    llmBaseUrl: input.llmBaseUrl,
    llmApiKeyEnv,
    useVision: booleanOr(input.useVision, DEFAULTS.useVision, 'useVision'),
    artifactDir: typeof input.artifactDir === 'string' && input.artifactDir.trim() !== ''
      ? input.artifactDir
      : DEFAULTS.artifactDir,
    maxHistoryChars: positiveInt(input.maxHistoryChars, DEFAULTS.maxHistoryChars, 'maxHistoryChars'),
    setupTimeoutMs: positiveInt(input.setupTimeoutMs, DEFAULTS.setupTimeoutMs, 'setupTimeoutMs'),
    startTimeoutMs: positiveInt(input.startTimeoutMs, DEFAULTS.startTimeoutMs, 'startTimeoutMs'),
    requestTimeoutMs: positiveInt(input.requestTimeoutMs, DEFAULTS.requestTimeoutMs, 'requestTimeoutMs'),
    shortRequestTimeoutMs: positiveInt(input.shortRequestTimeoutMs, DEFAULTS.shortRequestTimeoutMs, 'shortRequestTimeoutMs'),
  }
}

function sessionKey(exec) {
  const id = exec?.agent?.session?.id
  if (typeof id !== 'string' || id === '') throw new Error('Browser actions require a DSH session')
  return id
}

function workspaceRoot(exec) {
  return exec?.agent?.session?.header?.cwd ?? process.cwd()
}

function artifactDirFor(config, exec) {
  return isAbsolute(config.artifactDir) ? config.artifactDir : resolve(workspaceRoot(exec), config.artifactDir)
}

/** Run a command to completion, capturing output; rejects with the output tail on failure. */
function runCaptured(command, args, timeoutMs, label) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      child.kill()
      rejectRun(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const capture = (chunk, stream) => {
      if (stream === 'out') stdout = (stdout + chunk).slice(-COMMAND_OUTPUT_TAIL)
      else stderr = (stderr + chunk).slice(-COMMAND_OUTPUT_TAIL)
    }
    child.stdout.on('data', chunk => capture(chunk, 'out'))
    child.stderr.on('data', chunk => capture(chunk, 'err'))
    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectRun(new Error(`${label} failed to start: ${error.message}`))
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolveRun(stdout)
      else rejectRun(new Error(`${label} failed with exit code ${code}\n${stdout}\n${stderr}`))
    })
  })
}

/** Parse one sidecar stdout line into a reply, event, or null for non-protocol output. */
export function parseSidecarLine(line) {
  let message
  try { message = JSON.parse(line) } catch { return null }
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return null
  return message
}

/**
 * The plugin-managed Python runtime: one venv under venvRoot built from the
 * vendored browser-use source. The `.ready` marker records the vendored
 * version, so a vendor sync rebuilds the environment on the next tool call.
 */
export function createRuntime(config, run = runCaptured) {
  const venvDir = join(config.venvRoot, 'venv')
  const pythonBin = process.platform === 'win32' ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python')
  const markerPath = join(config.venvRoot, '.ready')
  const marker = `browser-use ${vendoredBrowserUseVersion()}`
  let pending = null

  async function probeBasePython() {
    const candidates = config.pythonExecutable
      ? [config.pythonExecutable]
      : process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python']
    for (const candidate of candidates) {
      try {
        const output = await run(candidate, ['-c', 'import sys; print(sys.version_info[0] * 100 + sys.version_info[1])'],
          30_000, `python probe (${candidate})`)
        if (Number.parseInt(output, 10) >= MIN_PYTHON_VERSION) return candidate
      } catch { /* try the next candidate */ }
    }
    throw new Error(`browser_use requires Python >= 3.11; set pythonExecutable in the plugin config (tried: ${candidates.join(', ')})`)
  }

  async function build() {
    if (existsSync(pythonBin) && existsSync(markerPath) && readFileSync(markerPath, 'utf8').trim() === marker) return pythonBin
    const basePython = await probeBasePython()
    await mkdir(config.venvRoot, { recursive: true })
    await rm(venvDir, { recursive: true, force: true })
    await run(basePython, ['-m', 'venv', venvDir], config.setupTimeoutMs, 'browser-use venv creation')
    await run(pythonBin, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', VENDOR_DIR],
      config.setupTimeoutMs, 'browser-use installation (vendored source plus pinned dependencies; needs network)')
    await writeFile(markerPath, `${marker}\n`)
    return pythonBin
  }

  return function ensure() {
    if (!pending) {
      pending = build().catch(error => {
        pending = null
        throw error
      })
    }
    return pending
  }
}

export class SidecarClient {
  constructor({ python, script = SIDECAR_PATH, cwd, env, logger, startTimeoutMs }) {
    this.python = python
    this.script = script
    this.cwd = cwd
    this.env = env
    this.logger = logger
    this.startTimeoutMs = startTimeoutMs
    this.child = null
    this.alive = false
    this.buffer = ''
    this.nextId = 1
    this.pending = new Map()
  }

  spawn() {
    this.child = spawn(this.python, [this.script], { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.alive = true
    this.child.stdout.on('data', chunk => this.receive(chunk))
    this.child.stderr.on('data', chunk => {
      const text = String(chunk).trim()
      if (text) this.logger?.debug(`browser-use sidecar stderr: ${text.slice(-COMMAND_OUTPUT_TAIL)}`)
    })
    this.child.on('exit', (code, signal) => {
      this.alive = false
      const error = new Error(`browser-use sidecar exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`)
      for (const entry of this.pending.values()) entry.reject(error)
      this.pending.clear()
    })
    this.child.on('error', error => {
      this.alive = false
      for (const entry of this.pending.values()) entry.reject(error)
      this.pending.clear()
    })
  }

  receive(chunk) {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line !== '') this.handleLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  handleLine(line) {
    const message = parseSidecarLine(line)
    if (message === null) return
    if (message.event === 'log') {
      this.logger?.debug(`browser-use: ${String(message.message ?? '')}`)
      return
    }
    if (message.event === 'fatal') {
      const error = new Error(`browser-use sidecar failed to start: ${String(message.message ?? 'unknown error')}`)
      for (const entry of this.pending.values()) entry.reject(error)
      this.pending.clear()
      this.child?.kill()
      return
    }
    if (message.id === undefined) return
    const entry = this.pending.get(message.id)
    if (!entry) return
    this.pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.ok) entry.resolve(message.result ?? {})
    else entry.reject(new Error(typeof message.error === 'string' ? message.error : JSON.stringify(message.error)))
  }

  request(method, params, timeoutMs) {
    if (!this.alive || !this.child) return Promise.reject(new Error('browser-use sidecar is not running'))
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        rejectRequest(new Error(`browser-use ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, {
        timer,
        resolve: resolveRequest,
        reject: rejectRequest,
      })
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }

  async start() {
    this.spawn()
    try {
      const pong = await this.request('ping', {}, this.startTimeoutMs)
      return pong
    } catch (error) {
      await this.kill()
      throw error
    }
  }

  kill() {
    return new Promise(resolveKill => {
      if (!this.child) { resolveKill(); return }
      if (!this.alive) { resolveKill(); return }
      const fallback = setTimeout(resolveKill, 5000)
      this.child.once('exit', () => {
        clearTimeout(fallback)
        resolveKill()
      })
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(new Error('browser-use sidecar stopped'))
      }
      this.pending.clear()
      this.child.kill()
    })
  }
}

/** Build the sidecar process environment; the API key travels by env and is never logged. */
export function buildSidecarEnv(config, exec) {
  return {
    ...process.env,
    DSH_BU_CDP_URL: config.chromeEndpoint,
    DSH_BU_HEADLESS: String(config.headless),
    DSH_BU_ARTIFACT_DIR: artifactDirFor(config, exec),
    DSH_BU_LLM_PROVIDER: config.llmProvider,
    DSH_BU_LLM_MODEL: config.llmModel,
    ...(config.llmBaseUrl ? { DSH_BU_LLM_BASE_URL: config.llmBaseUrl } : {}),
    DSH_BU_API_KEY: process.env[config.llmApiKeyEnv] ?? '',
    DSH_BU_MAX_HISTORY_CHARS: String(config.maxHistoryChars),
    DSH_BU_MAX_STEPS: String(config.maxSteps),
    ANONYMIZED_TELEMETRY: 'false',
  }
}

function outputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'action'],
    properties: {
      ok: { type: 'boolean' },
      action: { type: 'string' },
      done: { type: 'boolean' },
      final_result: { type: 'string' },
      errors: { type: 'array', items: { type: 'string' } },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['step', 'action', 'result'],
          properties: { step: { type: 'integer' }, action: { type: 'string' }, result: { type: 'string' } },
        },
      },
      url: { type: 'string' },
      title: { type: 'string' },
      elapsed_s: { type: 'number' },
      screenshot_path: { type: 'string' },
      stopped: { type: 'boolean' },
    },
  }
}

export function apply(ctx, rawConfig = {}, deps = {}) {
  const config = normalizeConfig(rawConfig)
  const ensureRuntime = deps.ensureRuntime ?? createRuntime(config)
  const sidecars = new Map()
  const chromeConfig = {
    chromeEndpoint: config.chromeEndpoint,
    chromeConnectTimeoutMs: config.chromeConnectTimeoutMs,
    chromeUserDataDir: config.chromeUserDataDir,
    ...(config.chromeExecutablePath ? { chromeExecutablePath: config.chromeExecutablePath } : {}),
  }

  // Warm the runtime in the background so the first tool call usually finds it ready.
  void ensureRuntime().catch(error => {
    ctx.logger?.warn(`browser-use runtime setup failed: ${String(error.message ?? error).slice(0, COMMAND_OUTPUT_TAIL)}`)
  })

  const launchSidecar = deps.launchSidecar ?? (async exec => {
    const python = await ensureRuntime()
    if (config.chromeEndpoint) {
      // Ensure the integrated Chrome is up, then release this client connection;
      // the browser process belongs to the Chrome bundle.
      const browser = await connectChrome(chromeConfig)
      await browser.close().catch(() => {})
    }
    const client = new SidecarClient({
      python,
      cwd: workspaceRoot(exec),
      env: buildSidecarEnv(config, exec),
      logger: ctx.logger,
      startTimeoutMs: config.startTimeoutMs,
    })
    await client.start()
    return client
  })

  async function sidecarFor(exec) {
    const key = sessionKey(exec)
    const existing = sidecars.get(key)
    if (existing) {
      const client = await existing.catch(() => null)
      if (client?.alive) return client
      if (client) await client.kill().catch(() => {})
      sidecars.delete(key)
    }
    const pending = launchSidecar(exec)
    sidecars.set(key, pending)
    try {
      return await pending
    } catch (error) {
      if (sidecars.get(key) === pending) sidecars.delete(key)
      throw error
    }
  }

  ctx.effect(() => {
    return async () => {
      const launches = [...sidecars.values()]
      sidecars.clear()
      const clients = (await Promise.allSettled(launches))
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value)
      await Promise.allSettled(clients.map(client => client.kill()))
    }
  })

  ctx.effect(() => ctx.skills.register({
    name: 'browser-use',
    description: 'Drive the integrated browser with the browser-use agent under harness supervision: browser mode is mandatory for web actions, every run returns a screenshot to analyze, and revisions arrive as new tasks. Load for operating websites.',
    source: 'runtime',
    content: SKILL_CONTENT,
    invocation: { modelInvocable: true, userInvocable: true },
  }))

  const browserUseTool = {
    name: 'browser_use',
    description: 'Drive the session browser with the browser-use agent. ALWAYS use browser mode (this tool, or the integrated `browser` tool) for actions on a website instead of fetch/curl/web-search. Send one concrete task per run; browser-use executes it in the visible session Chrome and returns the result with a screenshot. Read the screenshot, compare it with the intent, then confirm completion or send a revised task. Use `screenshot` for an on-demand capture and `stop` to cancel an active run.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['run', 'screenshot', 'stop'] },
        task: { type: 'string', description: 'Concrete instruction for the run action, with explicit success criteria.' },
        max_steps: { type: 'integer', description: 'Optional step budget for run; capped by the configured maxSteps.' },
        use_vision: { type: 'boolean', description: 'Send page screenshots to the browser-use model; only with a vision-capable llmModel.' },
        path: { type: 'string', description: 'Optional screenshot file path; relative paths resolve inside the artifact directory.' },
        full_page: { type: 'boolean', description: 'Capture the full page for screenshot; default true.' },
      },
    },
    output: {
      schema: outputSchema(),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (exec.signal?.aborted) throw new Error('browser_use call aborted')
      const action = args.action
      if (action === 'run') {
        const task = typeof args.task === 'string' && args.task.trim() !== '' ? args.task : null
        if (!task) throw new Error('browser_use action run: task is required')
        const maxSteps = Number.isInteger(args.max_steps) && args.max_steps > 0
          ? Math.min(args.max_steps, config.maxSteps)
          : config.maxSteps
        const client = await sidecarFor(exec)
        const result = await client.request('run', {
          task,
          max_steps: maxSteps,
          use_vision: args.use_vision ?? config.useVision,
        }, config.requestTimeoutMs)
        return { ok: true, action, ...result }
      }
      if (action === 'screenshot') {
        const client = await sidecarFor(exec)
        const artifactRoot = artifactDirFor(config, exec)
        const target = typeof args.path === 'string' && args.path.trim() !== ''
          ? (isAbsolute(args.path) ? args.path : resolve(artifactRoot, args.path))
          : undefined
        const result = await client.request('screenshot', {
          full_page: args.full_page ?? true,
          ...(target ? { path: target } : {}),
        }, config.shortRequestTimeoutMs)
        return { ok: true, action, ...result }
      }
      if (action === 'stop') {
        const pending = sidecars.get(sessionKey(exec))
        if (!pending) return { ok: true, action, stopped: false }
        const client = await pending.catch(() => undefined)
        if (!client?.alive) return { ok: true, action, stopped: false }
        const result = await client.request('stop', {}, config.shortRequestTimeoutMs)
        return { ok: true, action, ...result }
      }
      throw new Error(`unsupported browser_use action: ${action}`)
    },
  }
  ctx.effect(() => ctx.tools.register(browserUseTool))
}
