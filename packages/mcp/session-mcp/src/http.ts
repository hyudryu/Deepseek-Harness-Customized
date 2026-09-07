/** Loopback HTTP admission and request-scoped MCP transport ownership. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Config } from './config.ts'
import { createSessionMcp } from './mcp.ts'
import type { SessionManagement } from './sessions.ts'

/** HTTP callbacks owned by the plugin's listener or shared Web route. */
export interface McpHandler {
  /**
   * Admit and settle one HTTP exchange.
   * @param request - incoming HTTP request.
   * @param response - outgoing HTTP response.
   * @returns request settlement.
   */
  handle(this: void, request: IncomingMessage, response: ServerResponse): Promise<void>
  /**
   * Abort and settle every admitted exchange.
   * @returns completion of request cleanup.
   */
  close(): Promise<void>
}

function reply(response: ServerResponse, status: number, message: string): void {
  if (response.destroyed || response.writableEnded) return
  if (response.headersSent) { response.destroy(); return }
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(message)
}

function readBody(request: IncomingMessage, maximum: number, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let length = 0
    const cleanup = (): void => {
      request.off('data', data)
      request.off('end', end)
      request.off('error', failure)
      signal.removeEventListener('abort', aborted)
    }
    const failure = (error: Error): void => { cleanup(); reject(error) }
    const aborted = (): void => { failure(new Error('MCP request aborted', { cause: signal.reason })) }
    const data = (chunk: Buffer): void => {
      length += chunk.length
      if (length > maximum) { failure(new Error('Request body exceeds configured byte limit')); return }
      chunks.push(chunk)
    }
    const end = (): void => {
      cleanup()
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown) }
      catch (error) { reject(new Error('Invalid JSON body', { cause: error })) }
    }
    request.on('data', data)
    request.once('end', end)
    request.once('error', failure)
    signal.addEventListener('abort', aborted, { once: true })
  })
}

function validId(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false
  if (!('id' in body)) return true
  return typeof body.id === 'string'
    ? Buffer.byteLength(body.id, 'utf8') <= 128
    : typeof body.id === 'number' && Number.isSafeInteger(body.id)
}

/**
 * Create bounded stateless MCP exchanges on an existing HTTP listener.
 * @param management - authoritative session reader and controller.
 * @param config - validated endpoint and admission limits.
 * @param getPort - current listener port, including OS-assigned ports.
 * @returns request dispatcher and quiescent disposer.
 */
export function createMcpHandler(management: SessionManagement, config: Config, getPort: () => number): McpHandler {
  const active = new Map<AbortController, Promise<void>>()
  let closed = false
  return {
    async handle(request, response) {
      if (closed) { reply(response, 503, 'MCP server is closing'); return }
      if (request.url?.split('?', 1)[0] !== config.path) { reply(response, 404, 'Not found'); return }
      const remote = request.socket.remoteAddress
      const authorities = ['localhost', '127.0.0.1', '[::1]'].map(host => `${host}:${String(getPort())}`)
      const host = request.headers.host
      const origin = request.headers.origin
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '')
        || !authorities.includes(host ?? '')
        || (origin !== undefined && !authorities.some(authority => origin === `http://${authority}`))) {
        reply(response, 403, 'Loopback Host and Origin required'); return
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST')
        reply(response, 405, 'Use POST for stateless MCP'); return
      }
      if (active.size >= config.maxConcurrentRequests) { reply(response, 429, 'MCP request limit reached'); return }
      const controller = new AbortController()
      const settled = Promise.withResolvers<void>()
      active.set(controller, settled.promise)
      const responseSettled = Promise.withResolvers<void>()
      const responseDone = (): void => { responseSettled.resolve() }
      response.once('finish', responseDone)
      response.once('close', responseDone)
      let transport: StreamableHTTPServerTransport | undefined
      let server: ReturnType<typeof createSessionMcp> | undefined
      const operations = new Set<Promise<unknown>>()
      const disconnected = (): void => {
        if (!response.writableFinished) controller.abort(new Error('MCP client disconnected'))
      }
      const stop = (): void => {
        reply(response, 503, 'MCP request cancelled')
        request.resume()
      }
      const timer = setTimeout(() => {
        reply(response, 504, 'MCP request timed out')
        controller.abort(new Error('MCP request timed out'))
      }, config.requestTimeoutMs)
      response.once('close', disconnected)
      controller.signal.addEventListener('abort', stop, { once: true })
      try {
        const body = await readBody(request, config.maxRequestBytes, controller.signal)
        if (!validId(body)) { reply(response, 400, 'Expected one MCP request with a bounded string or integer id'); return }
        controller.signal.throwIfAborted()
        transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
        server = createSessionMcp(management, config, controller.signal, (operation) => {
          operations.add(operation)
          void operation.then(() => { operations.delete(operation) }, () => { operations.delete(operation) })
        })
        // SDK transport setters accept undefined while its Transport interface uses exact optional callbacks.
        await server.connect(transport as Transport)
        await transport.handleRequest(request, response, body)
        await responseSettled.promise
      } catch (error) {
        const oversized = error instanceof Error && error.message.includes('byte limit')
        reply(response, oversized ? 413 : 400, oversized ? 'Request body exceeds configured byte limit' : 'Invalid or cancelled MCP request')
        request.resume()
      } finally {
        clearTimeout(timer)
        response.off('close', disconnected)
        response.off('finish', responseDone)
        response.off('close', responseDone)
        controller.signal.removeEventListener('abort', stop)
        controller.abort(new Error('MCP request settled'))
        await Promise.allSettled([transport?.close(), server?.close(), ...operations])
        active.delete(controller)
        settled.resolve()
      }
    },
    async close() {
      closed = true
      const pending = [...active.values()]
      for (const controller of active.keys()) controller.abort(new Error('MCP server disposed'))
      await Promise.all(pending)
    },
  }
}
