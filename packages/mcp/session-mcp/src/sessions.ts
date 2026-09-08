/** Passive session discovery and explicit control of agents owned by this process. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from './types.ts'

interface Page<T> {
  items: T[]
  total: number
  nextOffset: number | null
}

interface ProjectSummary {
  directory: string
  title: string
  sessionCount: number
}

interface SessionSummary {
  sessionId: SessionId
  title: string | null
  titleUnavailable?: boolean
  projectDirectory: string | null
  createdAt: number
  status: 'running' | 'idle' | 'not_active_here'
  attached: boolean
  persisted: boolean
}

interface TruncatedEvent {
  seq: number
  type: string
  time: number
  truncated: true
  originalBytes: number
  jsonPreview: string
}

interface TranscriptPage {
  sessionId: SessionId
  title: string | null
  projectDirectory: string | null
  status: SessionSummary['status']
  capturedThroughSeq: number
  events: Array<SessionEvent | TruncatedEvent>
  nextAfterSeq: number
  hasMore: boolean
}

interface TitleResolutionFailure {
  error: string
  candidates: SessionSummary[]
}

interface MessageAcknowledgment {
  sessionId: SessionId
  accepted: boolean
  messageId: UserMessage['id']
  mode: 'queue' | 'steer'
}

interface CancellationAcknowledgment {
  sessionId: SessionId
  cancellationRequested: boolean
  pendingMessagesPreserved: boolean
}

/** Reads never activate sessions; mutations address only this process's live ordinary agents. */
export class SessionManagement {
  /**
   * @param ctx - host session query and agent services.
   * @param limits - maximum page entries and serialized response bytes.
   */
  constructor(private readonly ctx: Context, private readonly limits: {
    maxPageSize: number
    maxResponseBytes: number
  }) {}

  /**
   * List registered projects and directories recorded by sessions.
   * @param request - offset and page size.
   * @param signal - cancellation during corpus reads.
   * @returns project directories, names, and session counts with continuation.
   */
  async listProjects(
    request: { offset?: number | undefined; limit?: number | undefined }, signal?: AbortSignal,
  ): Promise<Page<ProjectSummary>> {
    const records = await this.ctx.sessionQuery.listSessions(signal)
    signal?.throwIfAborted()
    const projects = new Map<string, ProjectSummary>()
    for (const project of this.ctx.get('workspaceRegistry')?.list() ?? []) {
      projects.set(project.path, { directory: project.path, title: project.title, sessionCount: 0 })
    }
    for (const { header } of records) {
      if (header.cwd === undefined) continue
      let project = projects.get(header.cwd)
      if (project === undefined) {
        project = { directory: header.cwd, title: header.cwd.split(/[\\/]/u).filter(Boolean).at(-1) ?? header.cwd, sessionCount: 0 }
        projects.set(header.cwd, project)
      }
      project.sessionCount++
    }
    return this.page([...projects.values()].sort((a, b) => a.directory.localeCompare(b.directory)), request)
  }

  /**
   * List sessions, optionally matching a title or ID substring in one directory.
   * @param request - directory, literal query, and pagination.
   * @param signal - cancellation during corpus and title reads.
   * @returns session identities and process-local status with continuation.
   */
  async listSessions(request: {
    projectDirectory?: string | undefined
    query?: string | undefined
    offset?: number | undefined
    limit?: number | undefined
  }, signal?: AbortSignal): Promise<Page<SessionSummary>> {
    const rows = await this.summaries(request.projectDirectory, signal)
    const query = request.query?.toLocaleLowerCase()
    return this.page(query === undefined ? rows : rows.filter(row =>
      row.sessionId.toLocaleLowerCase().includes(query) || row.title?.toLocaleLowerCase().includes(query)), request)
  }

  /**
   * Read chronological durable events after a cursor without activating an agent.
   * @param request - exact ID or unique exact title, directory, cursor, and page size.
   * @param signal - cancellation during title resolution and observation.
   * @returns a captured log cursor and bounded events; oversized events carry explicit JSON previews.
   */
  async readSession(
    request: {
      sessionId?: string | undefined
      title?: string | undefined
      projectDirectory?: string | undefined
      afterSeq?: number | undefined
      limit?: number | undefined
    },
    signal?: AbortSignal,
  ): Promise<TranscriptPage | TitleResolutionFailure> {
    if ((request.sessionId === undefined) === (request.title === undefined)) throw new Error('Provide exactly one sessionId or title.')
    let id = request.sessionId
    if (id === undefined) {
      const matches = (await this.summaries(request.projectDirectory, signal)).filter(row => row.title === request.title)
      const match = matches[0]
      if (matches.length !== 1 || match === undefined) {
        return this.bounded({ error: matches.length === 0 ? 'Session title not found.' : 'Session title is ambiguous. Use a sessionId.', candidates: this.page(matches, {}).items })
      }
      id = match.sessionId
    }
    const after = request.afterSeq ?? -1
    if (!Number.isSafeInteger(after) || after < -1) throw new Error('afterSeq must be an integer greater than or equal to -1.')
    const limit = this.pageLimit(request.limit)
    using observed = await this.ctx.sessionQuery.observeSession(SessionId(id), {
      ...(signal === undefined ? {} : { signal }), projectionMode: 'none',
    })
    signal?.throwIfAborted()
    if (request.projectDirectory !== undefined && observed.header.cwd !== request.projectDirectory) throw new Error('Session does not belong to the requested project directory.')
    if (after > observed.cursor) throw new Error('afterSeq is past the captured session cursor.')
    const metadata = {
      sessionId: SessionId(id),
      title: foldSessionTitle(observed.events)?.title ?? null,
      projectDirectory: observed.header.cwd ?? null,
      status: this.status(SessionId(id)),
      capturedThroughSeq: observed.cursor,
    }
    const events: Array<SessionEvent | TruncatedEvent> = []
    const response = () => ({
      ...metadata, events, nextAfterSeq: events.at(-1)?.seq ?? after, hasMore: (events.at(-1)?.seq ?? after) < observed.cursor,
    })
    for (const event of observed.events) {
      if (event.seq <= after) continue
      if (events.length === limit) break
      events.push(event)
      if (bytes(response()) <= this.limits.maxResponseBytes) continue
      events.pop()
      if (events.length > 0) break
      const serialized = JSON.stringify(event)
      const preview = { seq: event.seq, type: event.type, time: event.time, truncated: true as const, originalBytes: Buffer.byteLength(serialized), jsonPreview: '' }
      events.push(preview)
      this.bounded(response())
      let low = 0
      let high = serialized.length
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        preview.jsonPreview = serialized.slice(0, middle)
        if (bytes(response()) <= this.limits.maxResponseBytes) low = middle
        else high = middle - 1
      }
      preview.jsonPreview = serialized.slice(0, low)
      break
    }
    return this.bounded(response())
  }

  /**
   * Submit an identified user message to a live ordinary agent.
   * @param request - target ID, text, and queue or steering delivery.
   * @param signal - cancellation before admission.
   * @returns admission acknowledgment, not completion of the requested work.
   */
  sendMessage(
    request: { sessionId: string; text: string; mode: 'queue' | 'steer' }, signal?: AbortSignal,
  ): MessageAcknowledgment {
    signal?.throwIfAborted()
    if (request.text.trim().length === 0) throw new Error('Message text must not be empty.')
    const agent = this.liveAgent(request.sessionId)
    const message = createUserMessage({ content: [{ type: 'text', text: request.text }], source: { kind: 'session-mcp' } })
    const result = this.bounded({ sessionId: SessionId(request.sessionId), accepted: true, messageId: message.id, mode: request.mode })
    if (request.mode === 'steer') agent.steer(message)
    else agent.followup(message)
    return result
  }

  /**
   * Request cancellation while preserving pending messages.
   * @param request - live ordinary session ID.
   * @param signal - cancellation before admission.
   * @returns cancellation acknowledgment, not confirmation of quiescence.
   */
  stopSession(request: { sessionId: string }, signal?: AbortSignal): CancellationAcknowledgment {
    signal?.throwIfAborted()
    const agent = this.liveAgent(request.sessionId)
    const result = this.bounded({ sessionId: SessionId(request.sessionId), cancellationRequested: true, pendingMessagesPreserved: true })
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    return result
  }

  private liveAgent(id: string) {
    const agent = this.ctx.agents.get(SessionId(id))
    if (agent === undefined) throw new Error('Session has no active agent in this harness process. MCP does not resume stored sessions.')
    if (agent.session.header.origin === 'subagent' || !this.ctx.agents.roots().includes(agent)) {
      throw new Error('Subagent sessions are controlled by their owning agent.')
    }
    return agent
  }

  private status(id: SessionId): SessionSummary['status'] {
    return this.ctx.agents.get(id)?.status ?? 'not_active_here'
  }

  private async summaries(directory: string | undefined, signal: AbortSignal | undefined) {
    const records = (await this.ctx.sessionQuery.listSessions(signal))
      .filter(record => directory === undefined || record.header.cwd === directory)
    const titles = await this.ctx.sessionQuery.readTitleSnapshots(records.map(record => record.header.id), signal)
    signal?.throwIfAborted()
    const byId = new Map(titles.map(result => [result.sessionId, result]))
    return records.map((record: SessionRecord) => {
      const title = byId.get(record.header.id)
      return {
        sessionId: record.header.id,
        title: title?.status === 'fulfilled' ? title.value.title?.title ?? null : null,
        ...(title?.status === 'rejected' ? { titleUnavailable: true } : {}),
        projectDirectory: record.header.cwd ?? null,
        createdAt: record.header.createdAt,
        status: this.status(record.header.id),
        attached: record.live,
        persisted: record.persisted,
      }
    })
  }

  private pageLimit(limit: number | undefined) {
    const value = limit ?? this.limits.maxPageSize
    if (!Number.isSafeInteger(value) || value < 1 || value > this.limits.maxPageSize) throw new Error(`limit must be between 1 and ${String(this.limits.maxPageSize)}.`)
    return value
  }

  private page<T>(rows: T[], request: { offset?: number | undefined; limit?: number | undefined }) {
    const offset = request.offset ?? 0
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer.')
    const limit = this.pageLimit(request.limit)
    const items: T[] = []
    const response = () => ({ items, total: rows.length, nextOffset: offset + items.length < rows.length ? offset + items.length : null })
    for (const row of rows.slice(offset, offset + limit)) {
      items.push(row)
      if (bytes(response()) <= this.limits.maxResponseBytes) continue
      items.pop()
      if (items.length === 0) throw new Error('One result exceeds maxResponseBytes. Increase the configured response budget.')
      break
    }
    return this.bounded(response())
  }

  private bounded<T>(result: T): T {
    if (bytes(result) > this.limits.maxResponseBytes) throw new Error('Response metadata exceeds maxResponseBytes. Increase the configured response budget.')
    return result
  }
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value))
}
