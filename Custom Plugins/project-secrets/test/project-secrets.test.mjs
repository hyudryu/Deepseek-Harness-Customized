/** The project-secrets plugin advertises its block to the model by key name only. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { apply, secretsKeys, renderSecretsContext, __test } from '../index.js'

let directory

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-project-secrets-'))
})

after(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
})

/** Minimal Cordis double recording every registration the plugin makes. */
function createCtx({ rejection } = {}) {
  const tools = new Map()
  const skills = new Map()
  const contexts = new Map()
  const warnings = []
  const routes = []
  const ctx = {
    logger: { warn: message => { warnings.push(message) } },
    tools: { register: (spec) => { tools.set(spec.name, spec); return () => tools.delete(spec.name) } },
    skills: { register: (spec) => { skills.set(spec.name, spec); return () => skills.delete(spec.name) } },
    systemPrompt: { context: (spec) => { contexts.set(spec.name, spec); return () => contexts.delete(spec.name) } },
    webServer: { register: (route) => { routes.push(route); return () => {} } },
    workspaceRegistry: {
      get: () => undefined,
      set: (id, path) => { ctx.workspaceRegistry.get = () => ({ id, path }) },
    },
    connection: { requestRejection: () => rejection },
    effect: (fn) => { fn(); return () => {} },
    inject: (_services, callback) => { callback(ctx) },
  }
  return { ctx, tools, skills, contexts, warnings, routes }
}

/** One HTTP request/response double recording the status the handler chose. */
function httpDouble({ method = 'GET', path = '/project-secrets/ws-1', chunks = [] } = {}) {
  const recorded = { status: undefined, body: undefined, headers: undefined }
  const request = {
    method,
    url: path,
    headers: {},
    socket: {},
    async* [Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  }
  const response = {
    writeHead: (status, headers) => { recorded.status = status; recorded.headers = headers },
    end: (body) => { recorded.body = body },
    setHeader: () => {},
  }
  return { request, response: response, recorded }
}

/** Write one project's secrets block and return that project directory. */
async function project(name, text) {
  const root = join(directory, name)
  await mkdir(join(root, '.dsh'), { recursive: true })
  if (text !== undefined) await writeFile(join(root, '.dsh', 'project-secrets'), text, 'utf8')
  return root
}

/** The runtime-context text one project contributes to prompt assembly. */
function contextText(contexts, cwd) {
  const contribution = contexts.get('project-secrets')
  assert.ok(contribution, 'the plugin contributes runtime context named project-secrets')
  return contribution.text({ agent: { session: { header: { cwd } } } })
}

test('secretsKeys reads labels only and never a value', () => {
  const keys = secretsKeys('Node 4: hyudryu@spark-node-4\n\nUsername = root\nPassword: hunter2\nNode 4: other\n')
  assert.deepEqual(keys, ['Node 4', 'Username', 'Password'])
  assert.equal(keys.some(key => key.includes('hunter2') || key.includes('hyudryu')), false)
})

test('secretsKeys bounds stray long lines and the advertised count', () => {
  const long = `${'x'.repeat(200)}: value`
  const many = Array.from({ length: 60 }, (_value, index) => `Key ${String(index)}: v`).join('\n')
  assert.equal(secretsKeys(long)[0].length, 61)
  assert.equal(secretsKeys(many).length, 40)
})

test('renderSecretsContext names the keys and points at the tool', () => {
  const text = renderSecretsContext(['Node 4'])
  assert.match(text, /Node 4/)
  assert.match(text, /project_secrets/)
})

test('runtime context is registered after the shipped contributions', () => {
  const { ctx, contexts } = createCtx()
  apply(ctx, {})
  assert.equal(contexts.get('project-secrets').order, 130)
})

test('an empty, missing, or oversized block contributes no context', async () => {
  const { ctx, contexts } = createCtx()
  const empty = await project('empty')
  const oversized = await project('oversized', 'x'.repeat(64))
  apply(ctx, { maxBytes: 16 })
  assert.equal(contextText(contexts, empty), '')
  assert.equal(contextText(contexts, join(directory, 'missing-project')), '')
  assert.equal(contextText(contexts, oversized), '')
  assert.equal(contextText(contexts, undefined), '')
})

test('a populated block contributes its key names and no values', async () => {
  const { ctx, contexts } = createCtx()
  const root = await project('populated', 'Node 4: hyudryu@spark-node-4\nPassword: hunter2\n')
  apply(ctx, {})
  const text = contextText(contexts, root)
  assert.match(text, /Node 4/)
  assert.match(text, /Password/)
  assert.doesNotMatch(text, /hyudryu|spark-node-4|hunter2/)
})

test('a changed block contributes different text, which is what republishes it', async () => {
  const { ctx, contexts } = createCtx()
  const root = await project('changing', 'Node 4: hyudryu\n')
  apply(ctx, {})
  const before = contextText(contexts, root)
  await writeFile(join(root, '.dsh', 'project-secrets'), 'Node 4: hyudryu\nNode 5: other\n', 'utf8')
  const after = contextText(contexts, root)
  assert.notEqual(after, before)
  assert.match(after, /Node 5/)
})

test('each project contributes its own block', async () => {
  const { ctx, contexts } = createCtx()
  const first = await project('first', 'Node 4: a\n')
  const second = await project('second', 'Node 9: b\n')
  apply(ctx, {})
  assert.match(contextText(contexts, first), /Node 4/)
  assert.doesNotMatch(contextText(contexts, first), /Node 9/)
  assert.match(contextText(contexts, second), /Node 9/)
})

test('the registered tool and skill describe the block, not a file to open', () => {
  const { ctx, tools, skills } = createCtx()
  apply(ctx, {})
  assert.match(tools.get('project_secrets').description, /SSH targets/)
  assert.match(tools.get('project_secrets').description, /before reporting that you do not know/)
  assert.match(skills.get('project-secrets').description, /hostnames/)
})

test('path and text validation stay actionable', () => {
  // Platform-neutral: the same expression must hold on POSIX, where a `C:\work`
  // literal is a relative filename rather than an absolute path.
  const workspace = process.platform === 'win32' ? 'C:\\work' : '/work'
  assert.equal(
    __test.resolveSecretsPath(workspace, '.dsh/project-secrets', ''),
    join(workspace, '.dsh', 'project-secrets'),
  )
  assert.throws(() => __test.resolveSecretsPath(workspace, '', ''), /secretsFile/)
  assert.throws(() => __test.normalizeSecretsText('ab', 1), /exceed/)
  assert.throws(() => __test.normalizeSecretsText(1, 10), /string/)
})

test('a configured root relocates an absolute workspace path beneath it', () => {
  // Real sessions supply an absolute workspace path, which `resolve(root, path)`
  // would use verbatim — discarding the configured root entirely.
  const workspace = process.platform === 'win32' ? 'C:\\work\\projects\\demo' : '/work/projects/demo'
  const root = process.platform === 'win32' ? 'D:\\secrets' : '/secrets'
  const resolved = __test.resolveSecretsPath(workspace, '.dsh/project-secrets', root)
  assert.ok(resolved.startsWith(root), `${resolved} must be rooted under ${root}`)
  assert.match(resolved, /projects[/\\]demo/)
})

test('secretsKeys never advertises a line that is not a key/value pair', () => {
  // A multiline value — an OpenSSH key body, a wrapped token — has no separator
  // on its continuation lines. Reading those as key names would copy the secret
  // itself into the model-visible context and the durable session log.
  const block = [
    'Username = root',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB',
    '-----END OPENSSH PRIVATE KEY-----',
  ].join('\n')
  const keys = secretsKeys(block)
  assert.deepEqual(keys, ['Username'])
  const rendered = renderSecretsContext(keys)
  assert.doesNotMatch(rendered, /PRIVATE KEY|b3BlbnNzaC1rZXktdjE/)
})

test('a write that omits the payload is refused instead of clearing the block', async () => {
  const { ctx, tools } = createCtx()
  apply(ctx, {})
  const execute = tools.get('project_secrets').execute
  await assert.rejects(
    execute({ action: 'write' }, { agent: { session: { header: { cwd: directory } } } }),
    /requires a string "secrets" value/,
  )
  // Clearing stays explicit.
  const cleared = await execute({ action: 'write', secrets: '' }, { agent: { session: { header: { cwd: directory } } } })
  assert.equal(cleared.ok, true)
})

test('a written block is owner-only and concurrent writes do not collide', async () => {
  const file = join(directory, 'permissions', '.dsh', 'project-secrets')
  await __test.writeSecretsFile(file, 'a=1\n')
  if (process.platform !== 'win32') {
    const { mode } = await stat(file)
    assert.equal(mode & 0o777, 0o600, 'the secrets file must stay owner-only')
  }

  // Two writes in one process must not share a temporary path: the old
  // pid-derived name made one rename fail with ENOENT and left the content
  // nondeterministic.
  await Promise.all([
    __test.writeSecretsFile(file, 'first=1\n'),
    __test.writeSecretsFile(file, 'second=2\n'),
  ])
  const survivors = (await readdir(dirname(file))).filter(name => name.endsWith('.tmp'))
  assert.deepEqual(survivors, [], 'no temporary file may survive a completed write')
  assert.match(await readFile(file, 'utf8'), /^(first=1|second=2)\n$/)
})

test('an oversized file is rejected from its metadata before it is decoded', async () => {
  const file = join(directory, 'oversized-read', '.dsh', 'project-secrets')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, 'x'.repeat(4096), 'utf8')
  await assert.rejects(__test.readSecretsFile(file, 16), /exceed 16 bytes/)
  assert.throws(() => __test.readSecretsFileSync(file, 16), /exceed 16 bytes/)
})

test('the request bound admits a maximal value once JSON escaping is accounted for', () => {
  const maxBytes = 200000
  const limit = __test.requestByteLimit(maxBytes)
  // A value at exactly the limit, fully escaped, must still fit the bound.
  const worstCase = JSON.stringify({ text: '\u0000'.repeat(maxBytes) })
  assert.ok(Buffer.byteLength(worstCase, 'utf8') <= limit, 'a maximal escaped value must fit')
  // The bound still bounds.
  assert.ok(limit < maxBytes * 8)
})

test('the HTTP handler rejects an unauthenticated request before touching secrets', async () => {
  const { ctx, routes } = createCtx({ rejection: 401 })
  const root = await project('guarded', 'Password: hunter2\n')
  ctx.workspaceRegistry.set('ws-1', root)
  apply(ctx, {})
  const route = routes.find(candidate => candidate.path === '/project-secrets')

  for (const method of ['GET', 'PUT']) {
    const { request, response, recorded } = httpDouble({ method })
    await route.handler(request, response)
    assert.equal(recorded.status, 401, `${method} must be rejected`)
    assert.doesNotMatch(String(recorded.body), /hunter2/)
  }
})

test('the HTTP handler serves a read once the request is authenticated', async () => {
  const { ctx, routes } = createCtx({ rejection: undefined })
  const root = await project('served', 'Password: hunter2\n')
  ctx.workspaceRegistry.set('ws-1', root)
  apply(ctx, {})
  const route = routes.find(candidate => candidate.path === '/project-secrets')

  const { request, response, recorded } = httpDouble({ method: 'GET' })
  await route.handler(request, response)
  assert.equal(recorded.status, 200)
  assert.match(String(recorded.body), /hunter2/)
})
