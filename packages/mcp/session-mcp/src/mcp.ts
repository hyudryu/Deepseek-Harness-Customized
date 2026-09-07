/** MCP tool schemas and bounded JSON replies for external supervising agents. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { Config } from './config.ts'
import type { SessionManagement } from './sessions.ts'

/**
 * Register one stateless MCP request's tools against the shared session reader.
 * @param management - authoritative project/session reads and live controls.
 * @param config - validated tool and response limits.
 * @param signal - cancellation of this HTTP request or the owning plugin.
 * @param trackOperation - retain tool work until the HTTP owner has settled it.
 * @returns a fresh server with no cross-request protocol state.
 */
export function createSessionMcp(
  management: SessionManagement,
  config: Config,
  signal: AbortSignal,
  trackOperation: (operation: Promise<unknown>) => void,
): McpServer {
  const server = new McpServer({ name: 'dsh-session-management', version: '0.1.3-alpha.1' })
  const boundedString = z.string().min(1).max(config.maxRequestBytes)
  const page = {
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(config.maxPageSize).optional(),
  }
  const projectDirectory = boundedString.optional()
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  const result = async (operation: () => unknown): Promise<CallToolResult> => {
    try {
      signal.throwIfAborted()
      const pending = Promise.resolve().then(operation)
      trackOperation(pending)
      const value = await pending
      signal.throwIfAborted()
      const reply: CallToolResult = { content: [{ type: 'text', text: JSON.stringify(value) }] }
      // Reserve space for the wire request id, whose JSON serialization is bounded at HTTP admission.
      if (Buffer.byteLength(JSON.stringify(reply), 'utf8') + 512 > config.maxResponseBytes) {
        throw new Error('Response exceeds the configured byte limit; request a smaller page.')
      }
      return reply
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const bounded = Buffer.from(message).subarray(0, Math.floor((config.maxResponseBytes - 1024) / 8)).toString('utf8')
      return { isError: true, content: [{ type: 'text', text: bounded }] }
    }
  }
  server.registerTool('list_projects', {
    description: 'List projects with their directories and session counts, including registered empty projects. Use a directory to narrow session discovery.',
    inputSchema: page,
    annotations,
  }, args => result(() => management.listProjects(args, signal)))
  server.registerTool('list_sessions', {
    description: 'Find live and saved sessions by project directory and case-insensitive title or ID substring. Results include exact IDs, titles, availability, and activity in this harness process. Page through all candidates before choosing an ambiguous feature name.',
    inputSchema: { ...page, projectDirectory, query: boundedString.optional() },
    annotations,
  }, args => result(() => management.listSessions(args, signal)))
  server.registerTool('get_session', {
    description: 'Read a session by exact ID or an unambiguous exact title without resuming it. Returns chronological events after afterSeq, a next-page cursor, and current activity. Use the ID returned by list_sessions when titles are ambiguous. Truncated events are explicitly marked.',
    inputSchema: {
      sessionId: boundedString.optional(), title: boundedString.optional(), projectDirectory,
      afterSeq: z.number().int().min(-1).optional(), limit: page.limit,
    },
    annotations,
  }, args => result(() => management.readSession(args, signal)))
  if (config.allowControl) {
    server.registerTool('send_message', {
      description: 'Send a follow-up to a top-level session active in this harness process. queue schedules another turn; steer submits input at the next step boundary. Acceptance does not mean completion; inspect get_session to monitor progress. Saved sessions are not resumed.',
      inputSchema: { sessionId: boundedString, text: boundedString, mode: z.enum(['queue', 'steer']).default('queue') },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, args => result(() => management.sendMessage(args, signal)))
    server.registerTool('stop_session', {
      description: 'Request cancellation of the current work while preserving queued input for a top-level session active in this harness process. This does not delete the session. Read its status afterward to observe completion of cancellation.',
      inputSchema: { sessionId: boundedString },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    }, args => result(() => management.stopSession(args, signal)))
  }
  return server
}
