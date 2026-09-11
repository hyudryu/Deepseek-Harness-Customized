/**
 * Host-half behavior for the project system prompt override: path resolution,
 * byte bounds, the assemble waterfall that swaps in the override, and the
 * browser routes the modal drives.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile as writeRaw } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, describe, it } from 'node:test'
import { apply, normalizePromptText, projectDirFor, resolvePromptPath } from '../index.js'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'

const BASE_ASSEMBLY = {
  sections: [{ name: 'harness:identity', text: 'DEFAULT' }],
  contexts: [],
  tools: [],
  variables: {},
}

const temporaryDirs = []

after(async () => {
  for (const dir of temporaryDirs) await rm(dir, { recursive: true, force: true })
})

/** One fresh project directory owned by the running test file. */
async function projectDir() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-project-system-prompt-'))
  temporaryDirs.push(dir)
  return dir
}

/** The default override file inside one project directory. */
function promptFileIn(dir) {
  return join(dir, '.dsh', 'system-prompt.md')
}

/** Write one project override, creating the `.dsh` directory it lives in. */
async function writePrompt(dir, text) {
  await mkdir(join(dir, '.dsh'), { recursive: true })
  await writeRaw(promptFileIn(dir), text, 'utf8')
}

/** A context double exposing exactly the services and hooks the plugin uses. */
function createHarness({ workspaces = {}, assembly = BASE_ASSEMBLY } = {}) {
  const listeners = []
  const routes = []
  const ctx = {
    effect(fn) { return fn() },
    on(event, listener) { listeners.push({ event, listener }); return () => {} },
    webServer: { register(route) { routes.push(route); return () => {} } },
    workspaceRegistry: { get: (id) => workspaces[id] },
    systemPrompt: { assemble: async () => assembly },
  }
  apply(ctx)
  return {
    assembly: listeners.find(entry => entry.event === 'system-prompt/assemble').listener,
    route: routes[0],
  }
}

/** Run the registered assembly listener over one agent-shaped context. */
function assemble(harness, context) {
  return harness.assembly(BASE_ASSEMBLY, context, async () => BASE_ASSEMBLY)
}

/** A minimal Node request double for the prefix route. */
function request(method, url, body) {
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(body, 'utf8')
    },
  }
}

/** A minimal Node response double capturing status and JSON body. */
function response() {
  return {
    status: 0,
    body: undefined,
    writeHead(status) { this.status = status },
    end(value) { this.body = JSON.parse(value) },
  }
}

/** Drive one route call to completion. */
async function call(route, method, path, body) {
  const res = response()
  await route.handler(request(method, path, body), res)
  return res
}

const AGENT_CONTEXT = (cwd) => ({ agent: { session: { header: { cwd } } } })

describe('resolvePromptPath', () => {
  const PROJECT = resolve(tmpdir(), 'work', 'app')
  const RELATIVE = '.dsh/system-prompt.md'

  it('resolves a relative file inside the project directory', () => {
    assert.equal(resolvePromptPath(PROJECT, RELATIVE, ''), resolve(PROJECT, RELATIVE))
  })

  it('prefixes the project directory with a configured root', () => {
    const root = resolve(tmpdir(), 'mnt')
    assert.equal(resolvePromptPath(PROJECT, RELATIVE, root), resolve(root, PROJECT, RELATIVE))
  })

  it('uses an absolute prompt file as-is', () => {
    const absolute = resolve(PROJECT, 'prompt.md')
    assert.equal(resolvePromptPath(PROJECT, absolute, ''), absolute)
  })

  it('rejects an empty prompt file', () => {
    assert.throws(() => resolvePromptPath(PROJECT, '  ', ''), /promptFile must be a non-empty string/)
  })
})

describe('normalizePromptText', () => {
  it('accepts text at the byte bound', () => {
    assert.equal(normalizePromptText('abc', 3), 'abc')
  })

  it('rejects text past the byte bound', () => {
    assert.throws(() => normalizePromptText('abcd', 3), /system prompt exceeds 3 bytes/)
  })

  it('counts multibyte characters by their encoded bytes', () => {
    assert.throws(() => normalizePromptText('中', 2), /exceeds 2 bytes/)
  })

  it('rejects a non-string', () => {
    assert.throws(() => normalizePromptText(7, 10), /must be a string/)
  })
})

describe('projectDirFor', () => {
  it('reads the session working directory', () => {
    assert.equal(projectDirFor(AGENT_CONTEXT('/work/app')), '/work/app')
  })

  it('has no project outside a session', () => {
    assert.equal(projectDirFor({}), undefined)
    assert.equal(projectDirFor(undefined), undefined)
    assert.equal(projectDirFor(AGENT_CONTEXT('')), undefined)
  })
})

describe('system-prompt/assemble override', () => {
  it('leaves the assembly untouched without a project directory', async () => {
    const harness = createHarness()
    assert.deepEqual(await assemble(harness, {}), BASE_ASSEMBLY)
  })

  it('leaves the assembly untouched without an override file', async () => {
    const harness = createHarness()
    assert.deepEqual(await assemble(harness, AGENT_CONTEXT(await projectDir())), BASE_ASSEMBLY)
  })

  it('leaves the assembly untouched when the override is only whitespace', async () => {
    const dir = await projectDir()
    await writePrompt(dir, '   \n')
    const harness = createHarness()
    const assembled = await assemble(harness, AGENT_CONTEXT(dir))
    assert.deepEqual(assembled.sections, BASE_ASSEMBLY.sections)
  })

  it('replaces every section with the saved override', async () => {
    const dir = await projectDir()
    await writePrompt(dir, 'ONLY THIS')
    const harness = createHarness()
    const assembled = await assemble(harness, AGENT_CONTEXT(dir))
    assert.deepEqual(assembled.sections, [
      { name: 'project:system-prompt-override', text: 'ONLY THIS' },
    ])
    // Tools and variables still assemble; only the rendered section list changes.
    assert.deepEqual(assembled.tools, BASE_ASSEMBLY.tools)
  })

  it('observes an edited file on the next assembly', async () => {
    const dir = await projectDir()
    await writePrompt(dir, 'FIRST')
    const harness = createHarness()
    assert.equal((await assemble(harness, AGENT_CONTEXT(dir))).sections[0].text, 'FIRST')
    await writeRaw(promptFileIn(dir), 'SECOND-VALUE', 'utf8')
    assert.equal((await assemble(harness, AGENT_CONTEXT(dir))).sections[0].text, 'SECOND-VALUE')
  })

  it('drops an override whose file was removed', async () => {
    const dir = await projectDir()
    await writePrompt(dir, 'TEMPORARY')
    const harness = createHarness()
    assert.equal((await assemble(harness, AGENT_CONTEXT(dir))).sections[0].text, 'TEMPORARY')
    await rm(promptFileIn(dir), { force: true })
    assert.deepEqual((await assemble(harness, AGENT_CONTEXT(dir))).sections, BASE_ASSEMBLY.sections)
  })
})

describe('real SystemPrompt composition', () => {
  /**
   * Boot the real prompt service and apply the plugin exactly as the Loader
   * does: the plugin's own context is unscoped, so the listener must still
   * receive an agent-scoped assembly and its return value must be the one
   * `assemble` produces. The two host services the plugin declares are stubbed
   * because neither participates in assembly.
   */
  async function boot() {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    const isolated = new Proxy(ctx, {
      get(target, property, receiver) {
        if (property === 'webServer') return { register: () => () => {} }
        if (property === 'workspaceRegistry') return { get: () => undefined }
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    apply(isolated)
    ctx.systemPrompt.section({ name: 'tool:demo', order: 1000, text: 'Tool guidance.' })
    return ctx
  }

  it('replaces the whole prompt for a session inside an overridden project', async () => {
    const dir = await projectDir()
    await writePrompt(dir, 'PROJECT ONLY')
    const ctx = await boot()
    const agent = { session: { header: { cwd: dir } } }
    assert.equal(renderPrompt(await ctx.systemPrompt.assemble({ agent, scope: agent })), 'PROJECT ONLY')
  })

  it('keeps the deployment prompt for a session outside an overridden project', async () => {
    const dir = await projectDir()
    await writePrompt(dir, 'PROJECT ONLY')
    const ctx = await boot()
    const other = { session: { header: { cwd: await projectDir() } } }
    const rendered = renderPrompt(await ctx.systemPrompt.assemble({ agent: other, scope: other }))
    assert.match(rendered, /Tool guidance\./)
    assert.doesNotMatch(rendered, /PROJECT ONLY/)
  })

  it('interpolates prompt variables into the restored default', async () => {
    const dir = await projectDir()
    const harness = createHarness({
      workspaces: { w1: { path: dir } },
      assembly: {
        sections: [{ name: 'deployment:persona', text: 'Working directory is {{cwd}}.' }],
        contexts: [],
        tools: [],
        variables: { cwd: dir },
      },
    })
    const loaded = await call(harness.route, 'GET', '/project-system-prompt/w1')
    assert.equal(loaded.body.defaultText, `Working directory is ${dir}.`)
  })
})

describe('browser routes', () => {
  it('returns the saved override, the deployment default, and the file path', async () => {
    const dir = await projectDir()
    const harness = createHarness({ workspaces: { w1: { path: dir } } })
    const saved = await call(harness.route, 'PUT', '/project-system-prompt/w1', JSON.stringify({ text: 'MINE' }))
    assert.equal(saved.status, 200)
    const loaded = await call(harness.route, 'GET', '/project-system-prompt/w1')
    assert.equal(loaded.status, 200)
    assert.equal(loaded.body.text, 'MINE')
    assert.equal(loaded.body.defaultText, 'DEFAULT')
    assert.equal(loaded.body.path, join(dir, '.dsh', 'system-prompt.md'))
  })

  it('serves an empty override for a project that never saved one', async () => {
    const dir = await projectDir()
    const harness = createHarness({ workspaces: { w1: { path: dir } } })
    const loaded = await call(harness.route, 'GET', '/project-system-prompt/w1')
    assert.equal(loaded.body.text, '')
    assert.equal(loaded.body.defaultText, 'DEFAULT')
  })

  it('removes the file when the field is cleared', async () => {
    const dir = await projectDir()
    const harness = createHarness({ workspaces: { w1: { path: dir } } })
    await call(harness.route, 'PUT', '/project-system-prompt/w1', JSON.stringify({ text: 'MINE' }))
    const cleared = await call(harness.route, 'PUT', '/project-system-prompt/w1', JSON.stringify({ text: '' }))
    assert.deepEqual(cleared.body, { ok: true, cleared: true })
    await assert.rejects(readFile(join(dir, '.dsh', 'system-prompt.md'), 'utf8'), { code: 'ENOENT' })
  })

  it('rejects a request without a workspace id', async () => {
    const harness = createHarness()
    assert.equal((await call(harness.route, 'GET', '/project-system-prompt')).status, 400)
  })

  it('rejects an unknown workspace', async () => {
    const harness = createHarness()
    assert.equal((await call(harness.route, 'GET', '/project-system-prompt/nope')).status, 404)
  })

  it('rejects a malformed JSON body', async () => {
    const dir = await projectDir()
    const harness = createHarness({ workspaces: { w1: { path: dir } } })
    const res = await call(harness.route, 'PUT', '/project-system-prompt/w1', '{oops')
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'invalid JSON body')
  })

  it('rejects an oversized body before parsing it', async () => {
    const dir = await projectDir()
    const harness = createHarness({ workspaces: { w1: { path: dir } } })
    const res = await call(harness.route, 'PUT', '/project-system-prompt/w1', JSON.stringify({ text: 'x'.repeat(200001) }))
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'request body too large')
  })

  it('rejects an unsupported method', async () => {
    const dir = await projectDir()
    const harness = createHarness({ workspaces: { w1: { path: dir } } })
    assert.equal((await call(harness.route, 'DELETE', '/project-system-prompt/w1')).status, 405)
  })
})
