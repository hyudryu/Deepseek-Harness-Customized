/** The project-secrets plugin advertises its block to the model by key name only. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
function createCtx() {
  const tools = new Map()
  const skills = new Map()
  const contexts = new Map()
  const warnings = []
  const ctx = {
    logger: { warn: message => { warnings.push(message) } },
    tools: { register: (spec) => { tools.set(spec.name, spec); return () => tools.delete(spec.name) } },
    skills: { register: (spec) => { skills.set(spec.name, spec); return () => skills.delete(spec.name) } },
    systemPrompt: { context: (spec) => { contexts.set(spec.name, spec); return () => contexts.delete(spec.name) } },
    webServer: { register: () => () => {} },
    workspaceRegistry: { get: () => undefined },
    effect: (fn) => { fn(); return () => {} },
    inject: (_services, callback) => { callback(ctx) },
  }
  return { ctx, tools, skills, contexts, warnings }
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
  assert.equal(__test.resolveSecretsPath('C:\\work', '.dsh/project-secrets', ''), 'C:\\work\\.dsh\\project-secrets')
  assert.throws(() => __test.resolveSecretsPath('C:\\work', '', ''), /secretsFile/)
  assert.throws(() => __test.normalizeSecretsText('ab', 1), /exceed/)
  assert.throws(() => __test.normalizeSecretsText(1, 10), /string/)
})
