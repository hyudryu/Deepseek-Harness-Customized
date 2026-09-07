/** Real Loader composition preserves skill loading behind progressive bucket discovery. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import * as Buckets from '../src/index.ts'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'

let ctx: Context | undefined
let directory: string | undefined
afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

async function boot(): Promise<{ context: Context; agent: Agent }> {
  directory = await mkdtemp(join(tmpdir(), 'dsh-skill-buckets-'))
  for (const [name, description, body, invocation] of [
    ['aws-alpha', 'AWS deployment', 'Inspect the requested AWS resource.', ''],
    ['aws-beta', 'AWS billing', 'Read the requested AWS invoice.', ''],
    ['mcp-client', 'MCP integrations', 'Connect the named MCP server.', ''],
    ['code-review', 'Review changes', 'Read the patch before commenting.', ''],
    ['security-audit', 'Security auditing', 'Inspect authorization rules.', ''],
    ['writing-style', 'Clear writing', 'Prefer short sentences.', ''],
    ['aws-hidden', 'AWS hidden instructions', 'Never expose this skill.', 'disable-model-invocation: true\n'],
  ]) {
    const folder = join(directory, '.dsh', 'skills', name!)
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n${invocation}---\n\n${body}\n`)
  }
  const plugins = new Map<string, unknown>([
    ['llm', LlmRuntime], ['sessions', SessionStore], ['projection', SessionProjection], ['system-prompt', SystemPrompt],
    ['tools', ToolRuntime], ['agents', AgentRegistry], ['agent-loop', AgentLoop], ['skills', SkillRegistry],
    ['skill-filesystem', SkillFilesystem], ['tool-skill', ToolSkill], ['skill-buckets', Buckets],
  ])
  const configFile = join(directory, 'cordis.yml')
  await writeFile(configFile, [...plugins.keys()].map((name) => {
    const extra = name === 'agent-loop' ? '  config:\n    agents: []\n'
      : name === 'skill-filesystem' ? `  config:\n    includeDefaultRoots: false\n    customSkillDirs: [${JSON.stringify(join(directory!, '.dsh', 'skills'))}]\n    watch: false\n`
        : name === 'skill-buckets' ? '  config:\n    pageSize: 1\n' : ''
    return `- id: ${name}\n  name: ${name}\n${extra}`
  }).join(''))
  const context = ctx = new Context()
  context.baseUrl = pathToFileURL(directory).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  context.loader.internal = {
    version: 'v2', async import(name: string) {
      if (!plugins.has(name)) throw new Error(`Unknown fixture plugin ${name}`)
      return plugins.get(name)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configFile).href } })
  await context.loader.await()
  const agent = await context.agentLoop.create(SessionId('bucket-composition'), { provider: 'unused', model: 'unused' }, { cwd: directory })
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Find the AWS skill.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  return { context, agent }
}

async function publish(context: Context, agent: Agent): Promise<string> {
  const decision = await agentEvents(context, agent).waterfall('agent/pre-step', {
    messages: [], turn: 1, step: 1, signal: new AbortController().signal,
  }, () => Promise.resolve({ kind: 'enter' as const, messages: [] }))
  if (decision.kind !== 'enter') throw new Error('Expected the agent to enter its step')
  for (const message of decision.messages) agent.session.append('user/message', message, { surfaceOp: 'append' })
  return JSON.stringify(decision.messages)
}

it('publishes compact buckets, pages one category, and loads the original skill body', async () => {
  const { context, agent } = await boot()
  const initial = await publish(context, agent)
  expect(initial).toContain('skill_catalog')
  expect(initial).toContain('aws')
  expect(initial).not.toContain('aws-alpha')
  expect(initial).not.toContain('AWS deployment')
  expect(initial).not.toContain('Inspect the requested AWS resource.')
  expect(await publish(context, agent)).toBe('[]')
  const execute = (name: string, args: Record<string, unknown>) => context.tools.execute({
    name, arguments: args, agent, callId: ToolCallId('bucket-test'), signal: new AbortController().signal,
  })
  const first = await execute('skill_catalog', { bucket: 'aws' })
  expect(first.isError).toBe(false)
  expect(JSON.stringify(first.content)).toContain('aws-alpha')
  expect(JSON.stringify(first.content)).not.toContain('aws-beta')
  expect(JSON.stringify(first.content)).not.toContain('aws-hidden')
  expect(JSON.stringify(first.content)).not.toContain('mcp-client')
  const second = await execute('skill_catalog', { bucket: 'aws', offset: 1 })
  expect(second.isError).toBe(false)
  expect(JSON.stringify(second.content)).toContain('aws-beta')
  const loaded = await execute('skill', { name: 'aws-alpha' })
  expect(loaded.isError).toBe(false)
  expect(JSON.stringify(loaded.content)).toContain('Inspect the requested AWS resource.')
  expect((await execute('skill_catalog', { bucket: 'missing' })).isError).toBe(true)
  await Array.from(context.loader.entries()).find(entry => entry.options.id === 'skill-buckets')!.fiber!.dispose()
  expect(context.tools.schemas().map(schema => schema.name)).toEqual(['skill'])
  expect(await publish(context, agent)).toContain('aws-alpha')
})

it('keeps the complete initial catalog below one tenth of a large flat catalog', async () => {
  const { context, agent } = await boot()
  for (let index = 0; index < 400; index++) {
    context.skills.register({
      name: `aws-deployment-${String(index).padStart(3, '0')}`,
      description: `Deployment procedure ${index}: inspect AWS account identity, review the CloudFormation change set, validate service health, and report the selected resource.`,
      source: 'runtime', content: `Private deployment body ${index}.`,
    })
  }
  const bucketCatalog = await publish(context, agent)
  expect(bucketCatalog).not.toContain('Deployment procedure')
  expect(bucketCatalog).not.toContain('Private deployment body')
  expect(bucketCatalog).not.toContain('aws-deployment-000')
  await Array.from(context.loader.entries()).find(entry => entry.options.id === 'skill-buckets')!.fiber!.dispose()
  const flatCatalog = await publish(context, agent)
  expect(flatCatalog).toContain('Deployment procedure')
  expect(bucketCatalog.length).toBeLessThan(flatCatalog.length / 10)
})

it('projects the agent-scoped skill consumer through the global bucket plugin', async () => {
  const { context, agent } = await boot()
  await Array.from(context.loader.entries()).find(entry => entry.options.id === 'tool-skill')!.fiber!.dispose()
  let scope!: Scope
  await context.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, { inject: ['tools'] }))
  await scope.ctx.plugin(ToolSkill)
  expect(context.tools.get('skill')).toBeUndefined()
  expect(context.tools.get('skill', agent)).toBeDefined()
  expect(context.tools.get('skill_catalog', agent)).toBe(context.tools.get('skill_catalog'))
  const catalog = await publish(context, agent)
  expect(catalog).toContain('available_skill_buckets')
  expect(catalog).toContain('aws')
  expect(catalog).not.toContain('aws-alpha')
})

it('replaces bucket guidance when the final provider disappears', async () => {
  const { context, agent } = await boot()
  expect(await publish(context, agent)).toContain('available_skill_buckets')
  await Array.from(context.loader.entries()).find(entry => entry.options.id === 'skill-filesystem')!.fiber!.dispose()
  const empty = await publish(context, agent)
  expect(empty).not.toBe('[]')
  expect(empty).not.toContain('skill_catalog')
  expect(empty).not.toContain('available_skill_buckets')
  expect(await publish(context, agent)).toBe('[]')
})

it('filters within one bucket and validates pagination through actual tool dispatch', async () => {
  const { context, agent } = await boot()
  const execute = (args: Record<string, unknown>) => context.tools.execute({
    name: 'skill_catalog', arguments: args, agent, callId: ToolCallId('query-test'), signal: new AbortController().signal,
  })
  const filtered = await execute({ bucket: 'aws', query: ' BILLING ' })
  expect(filtered.isError).toBe(false)
  expect(JSON.stringify(filtered.content)).toContain('aws-beta')
  expect(JSON.stringify(filtered.content)).not.toContain('aws-alpha')
  expect(JSON.stringify(filtered.content)).not.toContain('nextOffset')
  expect(JSON.stringify((await execute({ bucket: 'aws', offset: 100 })).content)).toContain('[]')
  for (const offset of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect((await execute({ bucket: 'aws', offset })).isError).toBe(true)
  }
  expect(context.tools.get('skill_catalog')?.presentCall?.({ bucket: 'aws' })).toEqual({
    card: 'generic', title: 'Browse aws skills', kind: 'read', rawInput: 'aws',
  })
})

it('keeps prior guidance during incomplete discovery and fails the listing instead of returning partial results', async () => {
  const { context, agent } = await boot()
  await publish(context, agent)
  const undo = context.skills.registerProvider(() => ({
    name: 'incomplete', list: async () => ({ candidates: [], complete: false }), get: async () => undefined,
  }))
  expect(await publish(context, agent)).toBe('[]')
  const result = await context.tools.execute({
    name: 'skill_catalog', arguments: { bucket: 'aws' }, agent, callId: ToolCallId('incomplete'), signal: new AbortController().signal,
  })
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result.content)).toContain('incomplete')
  undo()
  expect(await publish(context, agent)).toBe('[]')
})

it('falls back for a hidden or same-name shadowed bucket tool and removes guidance for a hidden original loader', async () => {
  const { context, agent } = await boot()
  await publish(context, agent)
  let scope!: Scope
  await context.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, { inject: ['tools'] }))
  const undoRestriction = scope.ctx.tools.restrict({ deny: ['skill_catalog'] })
  expect(await publish(context, agent)).toContain('aws-alpha')
  undoRestriction()
  expect(await publish(context, agent)).toContain('available_skill_buckets')
  const undoShadow = scope.ctx.tools.register(defineContentToolFixture({
    name: 'skill_catalog', description: 'Unrelated scoped tool', parameters: {}, execute: async () => [],
  }))
  expect(await publish(context, agent)).toContain('aws-alpha')
  undoShadow()
  expect(await publish(context, agent)).toContain('available_skill_buckets')
  scope.ctx.tools.restrict({ deny: ['skill'] })
  const hidden = await publish(context, agent)
  expect(hidden).toContain('No skills are currently available')
  expect(hidden).not.toContain('available_skill_buckets')
  expect(await publish(context, agent)).toBe('[]')
})

it('refreshes equal-sized bucket membership changes without injecting the full skill list', async () => {
  const { context, agent } = await boot()
  await Array.from(context.loader.entries()).find(entry => entry.options.id === 'skill-filesystem')!.fiber!.dispose()
  const undo = context.skills.register({ name: 'aws-first', description: 'AWS first', source: 'runtime', content: 'First body' })
  const first = await publish(context, agent)
  expect(first).toContain('available_skill_buckets')
  undo()
  context.skills.register({ name: 'aws-second', description: 'AWS second', source: 'runtime', content: 'Second body' })
  const second = await publish(context, agent)
  expect(second).not.toBe('[]')
  expect(second).toContain('available_skill_buckets')
  expect(second).not.toContain('aws-second')
  expect(second).not.toContain('First body')
  expect(await publish(context, agent)).toBe('[]')
})
