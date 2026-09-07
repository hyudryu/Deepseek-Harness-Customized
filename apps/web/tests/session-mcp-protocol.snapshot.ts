/** Recorded session inspection through the shipped Web composition's MCP endpoint. */
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory,
  compareOrRefreshGolden,
  fixtureIdentity,
  launchWebScaffold,
  readPersistedEvents,
  seedSession,
  type WebScaffold,
} from './scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/session-mcp-protocol', import.meta.url))
const SESSION_ID = SessionId('session-mcp-protocol')
const CREATED_AT = 1786406400000

interface ProtocolExchange {
  readonly method: string
  readonly params: unknown
  readonly status: number
  readonly response: unknown
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an MCP JSON object')
  }
  return value as Record<string, unknown>
}

function toolValue(response: unknown): Record<string, unknown> {
  const result = record(record(response).result)
  expect(result.isError).not.toBe(true)
  if (!Array.isArray(result.content) || result.content.length !== 1) {
    throw new Error('Expected one MCP result text block')
  }
  const block = record(result.content[0])
  expect(block.type).toBe('text')
  const text = block.text
  if (typeof text !== 'string') throw new Error('Expected MCP result text')
  return record(JSON.parse(text))
}

/** Normalize only fixture identities and the isolated project's directory and display name. */
function normalizeProtocol(exchanges: readonly ProtocolExchange[], scaffold: WebScaffold): string {
  const replacements = new Map([
    [scaffold.workspaceCwd, '{{cwd}}'],
    [basename(scaffold.workspaceCwd), '{{projectTitle}}'],
    [fixtureIdentity('message', 1), '{{message:1}}'],
    [fixtureIdentity('message', 2), '{{message:2}}'],
  ])
  const normalize = (_key: string, value: unknown): unknown => typeof value === 'string'
    ? replacements.get(value) ?? value
    : value
  const normalized = exchanges.map((exchange) => {
    if (exchange.method !== 'tools/call') return exchange
    const response = record(exchange.response)
    const result = record(response.result)
    if (result.isError === true) return exchange
    const value = toolValue(response)
    const block = record((result.content as unknown[])[0])
    return {
      ...exchange,
      response: {
        ...response,
        result: { ...result, content: [{ ...block, text: JSON.stringify(value, normalize) }] },
      },
    }
  })
  return JSON.stringify(normalized, normalize, 2)
}

describe('session MCP recorded protocol', () => {
  let scaffold: WebScaffold

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    await seedSession(scaffold, await readFile(join(SNAPSHOT_DIR, 'session.v2.jsonl'), 'utf8'), SESSION_ID, undefined, {
      createdAt: CREATED_AT,
    })
  })

  afterAll(async () => {
    await scaffold?.close()
  })

  it('discovers and pages saved history without activating or changing it', async () => {
    const before = await readPersistedEvents(scaffold, SESSION_ID)
    expect(scaffold.ctx.sessions.get(SESSION_ID)).toBeUndefined()
    expect(scaffold.ctx.agents.get(SESSION_ID)).toBeUndefined()
    const exchanges: ProtocolExchange[] = []
    const invoke = async (method: string, params: unknown): Promise<unknown> => {
      const response = await scaffold.hostFetch('/MCP', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: exchanges.length + 1, method, params }),
      })
      const body: unknown = await response.json()
      exchanges.push({ method, params, status: response.status, response: body })
      return body
    }
    const call = (name: string, args: Record<string, unknown>): Promise<unknown> => invoke('tools/call', { name, arguments: args })

    await invoke('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'session-mcp-snapshot', version: '1.0.0' },
    })
    await invoke('tools/list', {})
    const projects = toolValue(await call('list_projects', { limit: 1 }))
    expect(projects.items).toEqual([{ directory: scaffold.workspaceCwd, title: basename(scaffold.workspaceCwd), sessionCount: 1 }])
    const sessions = toolValue(await call('list_sessions', { projectDirectory: scaffold.workspaceCwd, query: 'inspection', limit: 1 }))
    expect(sessions.items).toEqual([{
      sessionId: SESSION_ID,
      title: 'Session MCP inspection',
      projectDirectory: scaffold.workspaceCwd,
      createdAt: CREATED_AT,
      status: 'not_active_here',
      attached: false,
      persisted: true,
    }])
    const first = toolValue(await call('get_session', { title: 'Session MCP inspection', limit: 3 }))
    expect(first.hasMore).toBe(true)
    const remaining = toolValue(await call('get_session', { sessionId: SESSION_ID, afterSeq: first.nextAfterSeq, limit: 100 }))
    expect(remaining.hasMore).toBe(false)
    expect([...(first.events as unknown[]), ...(remaining.events as unknown[])]).toEqual(before)
    await call('send_message', { sessionId: SESSION_ID, text: 'Do not resume this saved conversation.', mode: 'queue' })
    await call('stop_session', { sessionId: SESSION_ID })
    expect(exchanges.slice(-2).every(exchange => record(record(exchange.response).result).isError === true)).toBe(true)
    expect(exchanges.every(exchange => exchange.status === 200)).toBe(true)
    expect(scaffold.ctx.sessions.get(SESSION_ID)).toBeUndefined()
    expect(scaffold.ctx.agents.get(SESSION_ID)).toBeUndefined()
    expect(await readPersistedEvents(scaffold, SESSION_ID)).toEqual(before)
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'protocol.expected.json'), normalizeProtocol(exchanges, scaffold), scaffold.mode)
    await assertFixtureInventory(SNAPSHOT_DIR, ['protocol.expected.json', 'session.v2.jsonl'])
  })
})
