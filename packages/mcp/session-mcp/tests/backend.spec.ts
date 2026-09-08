import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, UserMessage } from '@deepseek-ai/dsh-session'
import type { SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import { releasedV2SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v1-to-v2'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import { requireDirectHuman } from '@deepseek-ai/dsh-tool-goal/src/authority.ts'
import { describe, expect, it, vi } from 'vitest'
import { SessionManagement } from '../src/sessions.ts'

function fixture(maxResponseBytes = 10000, cwd: string | null = '/projects/first') {
  const header: SessionHeader = {
    id: SessionId('first'), version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false,
    ...(cwd === null ? {} : { cwd }),
  }
  const events: SessionEvent[] = [{ type: 'session/title', seq: SessionSeq(0), time: 1, data: { title: 'XYZ feature', messageSeqs: [], source: { kind: 'user' } } }]
  const dispose = vi.fn()
  const agent = { status: 'running', session: { header }, followup: vi.fn(), steer: vi.fn(), cancel: vi.fn() }
  const agents = new Map([[header.id, agent]])
  const records = [{ header, live: true, persisted: true }]
  const query = {
    listSessions: vi.fn(async () => records),
    readTitleSnapshots: vi.fn(async (): Promise<SessionTitleObservationResult[]> => records.map((record) => {
      const title = foldSessionTitle(events)
      return { sessionId: record.header.id, status: 'fulfilled', value: {
        session: record.header, ...(title === undefined ? {} : { title }),
      } }
    })),
    observeSession: vi.fn(async () => ({ header, events, cursor: events.at(-1)?.seq ?? -1, [Symbol.dispose]: dispose })),
  }
  // This isolated Consumer test supplies only the service methods it calls; Loader coverage owns the complete host composition.
  const registry = { list: vi.fn(() => [{ path: '/empty', title: 'Empty project' }]) }
  const get = vi.fn((): typeof registry | undefined => registry)
  const ctx = {
    sessionQuery: query,
    agents: { get: (id: SessionId) => agents.get(id), roots: () => [...agents.values()] },
    get,
  } as unknown as Context
  const management = new SessionManagement(ctx, { maxPageSize: 20, maxResponseBytes })
  return { management, query, records, events, dispose, agent, agents, header, get, registry }
}

function registryAgent(ctx: Context, id: string) {
  const session = Session.create(SessionId(id))
  return {
    id: session.id,
    session,
    options: {},
    status: 'running' as const,
    ctx,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    send: vi.fn(),
    followup: vi.fn<(message: UserMessage) => void>(),
    steer: vi.fn(),
    inject: vi.fn(),
    cancel: vi.fn(),
    whenIdle: () => Promise.resolve(),
    runMaintenance: task => task(new AbortController().signal),
  } satisfies Agent
}

describe('session management', () => {
  it('keeps empty registered projects and discovers directories from stored sessions', async () => {
    const { management } = fixture()
    expect(await management.listProjects({})).toEqual({ items: [
      { directory: '/empty', title: 'Empty project', sessionCount: 0 },
      { directory: '/projects/first', title: 'first', sessionCount: 1 },
    ], total: 2, nextOffset: null })
  })

  it('matches titles without activating agents and distinguishes inactive local ownership', async () => {
    const { management, agents, query } = fixture()
    agents.clear()
    expect((await management.listSessions({ query: 'xyz', projectDirectory: '/projects/first' })).items[0]).toMatchObject({ sessionId: 'first', title: 'XYZ feature', status: 'not_active_here' })
    expect((await management.listSessions({ projectDirectory: '/other' })).items).toEqual([])
    expect(query.observeSession).not.toHaveBeenCalled()
  })

  it('keeps registered titles for directories containing sessions', async () => {
    const { management, registry } = fixture()
    registry.list.mockReturnValue([{ path: '/projects/first', title: 'My project' }])
    expect((await management.listProjects({})).items).toEqual([
      { directory: '/projects/first', title: 'My project', sessionCount: 1 },
    ])
  })

  it('supports corpus-only root projects without a workspace registry', async () => {
    const { management, get } = fixture(10000, '/')
    get.mockReturnValue(undefined)
    expect((await management.listProjects({})).items).toEqual([{ directory: '/', title: '/', sessionCount: 1 }])
  })

  it('keeps untitled directory-less sessions addressable without inventing a project', async () => {
    const { management, events } = fixture(10000, null)
    events.splice(0)
    expect((await management.listProjects({})).items).toEqual([{ directory: '/empty', title: 'Empty project', sessionCount: 0 }])
    expect((await management.listSessions({})).items[0]).toMatchObject({ title: null, projectDirectory: null })
    expect(await management.readSession({ sessionId: 'first' })).toMatchObject({ title: null, projectDirectory: null, events: [] })
  })

  it('marks unavailable titles while preserving discovery of the stored session', async () => {
    const { management, query } = fixture()
    query.readTitleSnapshots.mockResolvedValue([{ sessionId: SessionId('first'), status: 'rejected', reason: new Error('unreadable title') }])
    expect((await management.listSessions({})).items[0]).toMatchObject({ title: null, titleUnavailable: true })
    expect(await management.readSession({ title: 'missing' })).toEqual({ error: 'Session title not found.', candidates: [] })
  })

  it('returns ambiguity candidates without choosing a duplicate title', async () => {
    const { management, records, header, query } = fixture()
    records.push({ header: { ...header, id: SessionId('second') }, live: false, persisted: true })
    const result = await management.readSession({ title: 'XYZ feature' })
    expect(result).toMatchObject({ candidates: [{ sessionId: 'first' }, { sessionId: 'second' }] })
    expect('error' in result && result.error).toContain('ambiguous')
    expect(query.observeSession).not.toHaveBeenCalled()
  })

  it('reads exact titles and releases passive observation leases on success and failure', async () => {
    const { management, query, dispose } = fixture()
    expect(await management.readSession({ title: 'XYZ feature' })).toMatchObject({ sessionId: 'first', capturedThroughSeq: 0, nextAfterSeq: 0, hasMore: false })
    expect(query.observeSession).toHaveBeenCalledWith('first', { projectionMode: 'none' })
    await expect(management.readSession({ sessionId: 'first', projectDirectory: '/wrong' })).rejects.toThrow('does not belong')
    expect(dispose).toHaveBeenCalledTimes(2)
  })

  it('bounds complete multibyte event responses and advances beyond oversized events', async () => {
    const { management, events } = fixture(600)
    events[0] = { type: 'session/title', seq: SessionSeq(0), time: 1, data: { title: 'small', messageSeqs: [], source: { kind: 'user' } } }
    events.push({ type: 'session/title', seq: SessionSeq(1), time: 2, data: { title: '😀'.repeat(1000), messageSeqs: [], source: { kind: 'user' } } })
    events.push({ type: 'session/title', seq: SessionSeq(2), time: 3, data: { title: 'small', messageSeqs: [], source: { kind: 'user' } } })
    const first = await management.readSession({ sessionId: 'first' })
    expect(first).toMatchObject({ nextAfterSeq: 0, hasMore: true })
    const second = await management.readSession({ sessionId: 'first', afterSeq: 0 })
    expect(Buffer.byteLength(JSON.stringify(second))).toBeLessThanOrEqual(600)
    expect(second).toMatchObject({ nextAfterSeq: 1, hasMore: true, events: [{ seq: 1, truncated: true }] })
    const event = 'events' in second ? second.events[0] : undefined
    expect(event !== undefined && 'originalBytes' in event && event.originalBytes).toBeGreaterThan(600)
    expect(event !== undefined && 'jsonPreview' in event && typeof event.jsonPreview).toBe('string')
    expect(await management.readSession({ sessionId: 'first', afterSeq: 1 })).toMatchObject({ nextAfterSeq: 2, hasMore: false })
    expect(await management.readSession({ sessionId: 'first', afterSeq: 2 })).toMatchObject({ events: [], hasMore: false })
  })

  it('uses response byte budgets to paginate lists without losing a continuation', async () => {
    const { management, records, header } = fixture(320)
    records.push({ header: { ...header, id: SessionId('second') }, live: false, persisted: true })
    const first = await management.listSessions({})
    expect(first.items).toHaveLength(1)
    expect(first.nextOffset).toBe(1)
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(320)
    const second = await management.listSessions({ offset: 1 })
    expect(second.items[0]?.sessionId).toBe('second')
    expect(second.nextOffset).toBeNull()
  })

  it('rejects budgets smaller than metadata without admitting controls', async () => {
    const { management, agent } = fixture(1)
    await expect(management.listSessions({})).rejects.toThrow('exceeds maxResponseBytes')
    await expect(management.readSession({ sessionId: 'first' })).rejects.toThrow('metadata exceeds')
    expect(() => management.stopSession({ sessionId: 'first' })).toThrow('metadata exceeds')
    expect(agent.cancel).not.toHaveBeenCalled()
  })

  it('rejects future cursors and invalid selectors and preserves disposal', async () => {
    const { management, dispose } = fixture()
    await expect(management.readSession({})).rejects.toThrow('exactly one')
    await expect(management.readSession({ sessionId: 'first', afterSeq: 5 })).rejects.toThrow('past')
    expect(dispose).toHaveBeenCalledOnce()
    await expect(management.listSessions({ limit: 0 })).rejects.toThrow('limit')
    await expect(management.listProjects({ offset: -1 })).rejects.toThrow('offset')
    await expect(management.readSession({ sessionId: 'first', afterSeq: -2 })).rejects.toThrow('afterSeq')
  })

  it('passes cancellation to passive reads and respects an event-count page limit', async () => {
    const { management, query, events } = fixture()
    events.push({ type: 'session/title', seq: SessionSeq(1), time: 2, data: {
      title: 'Updated title', messageSeqs: [], source: { kind: 'user' },
    } })
    const signal = new AbortController().signal
    expect(await management.readSession({ sessionId: 'first', limit: 1 }, signal)).toMatchObject({ nextAfterSeq: 0, hasMore: true })
    expect(query.observeSession).toHaveBeenCalledWith('first', { signal, projectionMode: 'none' })
  })

  it('admits identified queue and steering messages and preserves queued messages on stop', () => {
    const { management, agent } = fixture()
    const admitted = management.sendMessage({ sessionId: 'first', text: 'Continue', mode: 'queue' })
    expect(admitted.accepted).toBe(true)
    expect(typeof admitted.messageId).toBe('string')
    management.sendMessage({ sessionId: 'first', text: 'Adjust course', mode: 'steer' })
    expect(agent.followup).toHaveBeenCalledWith(expect.objectContaining({ content: [{ type: 'text', text: 'Continue' }], source: { kind: 'session-mcp' } }))
    expect(agent.steer).toHaveBeenCalledOnce()
    expect(management.stopSession({ sessionId: 'first' })).toMatchObject({ cancellationRequested: true })
    expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
  })

  it('rejects inactive, child-owned, empty and cancelled controls before mutation', () => {
    const { management, agents, agent, header } = fixture()
    expect(() => management.sendMessage({ sessionId: 'first', text: ' ', mode: 'queue' })).toThrow('empty')
    agent.session.header = { ...header, origin: 'subagent' }
    expect(() => management.stopSession({ sessionId: 'first' })).toThrow('owning agent')
    agents.clear()
    expect(() => management.stopSession({ sessionId: 'first' })).toThrow('does not resume')
    expect(() => management.stopSession({ sessionId: 'first' }, AbortSignal.abort())).toThrow()
    expect(agent.cancel).not.toHaveBeenCalled()
  })

  it('rejects runtime child ownership even when durable origin is unset', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const root = registryAgent(ctx, 'root')
    const child = registryAgent(ctx, 'extension-child')
    const detachRoot = ctx.agents.enter(root, undefined)
    const detachChild = ctx.agents.enter(child, root)
    const management = new SessionManagement(ctx, { maxPageSize: 20, maxResponseBytes: 10000 })
    try {
      expect(child.session.header.origin).toBeUndefined()
      expect(ctx.agents.roots()).toEqual([root])
      expect(() => management.sendMessage({ sessionId: child.id, text: 'Override parent', mode: 'steer' })).toThrow('owning agent')
      expect(() => management.stopSession({ sessionId: child.id })).toThrow('owning agent')
      expect(child.steer).not.toHaveBeenCalled()
      expect(child.cancel).not.toHaveBeenCalled()
    } finally {
      detachChild()
      detachRoot()
      await ctx.fiber.dispose()
    }
  })

  it('preserves durable MCP provenance without granting direct-human goal authority', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const agent = registryAgent(ctx, 'supervised')
    const detach = ctx.agents.enter(agent, undefined)
    const management = new SessionManagement(ctx, { maxPageSize: 20, maxResponseBytes: 10000 })
    try {
      management.sendMessage({ sessionId: agent.id, text: 'Create a goal', mode: 'queue' })
      const message = vi.mocked(agent.followup).mock.calls[0]?.[0]
      if (message === undefined) throw new Error('MCP did not deliver a message')
      agent.session.append('turn/start', { turn: 1 })
      agent.session.append('user/message', message, { surfaceOp: 'append' })
      expect(message.source).toEqual({ kind: 'session-mcp' })
      expect(() => {
        requireDirectHuman(ctx, {
          agent, events: agent.session.snapshotEvents(), openTurnStartSeq: SessionSeq(0),
        })
      }).toThrow('requires a direct human turn')
      agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      const decoded = releasedV2SessionFormatCodec.decodeArtifact(
        { type: 'session', delegationDepth: 0, ...agent.session.header }, agent.session.snapshotEvents(),
      )
      expect(decoded.events[1]?.data).toMatchObject({ source: { kind: 'session-mcp' } })
    } finally {
      detach()
      await ctx.fiber.dispose()
    }
  })
})
