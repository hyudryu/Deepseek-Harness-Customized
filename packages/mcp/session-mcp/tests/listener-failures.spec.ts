/** Listener fault containment and disposal while a socket bind is pending. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import SessionMcpServer, { Config } from '../src/index.ts'
import { createMcpHandler } from '../src/http.ts'

vi.mock('../src/http.ts', () => ({ createMcpHandler: vi.fn() }))

const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

function context(): Context {
  const ctx = new Context()
  roots.push(ctx)
  ctx.provide('sessions', {} as never)
  ctx.provide('sessionQuery', {} as never)
  ctx.provide('agents', {} as never)
  return ctx
}

it('contains unexpected handler rejection before and after headers have been sent', async () => {
  const ctx = context()
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  vi.mocked(createMcpHandler).mockReturnValue({
    async handle(request, response) {
      if (request.url === '/partial') {
        response.writeHead(200)
        response.write('partial')
        throw 'handler failure'
      }
      throw new Error('handler failure')
    },
    async close() {},
  })
  await ctx.plugin(SessionMcpServer, Config({ port: 0 } as Config))
  const endpoint = ctx.sessionMcp.endpoint
  expect((await fetch(endpoint)).status).toBe(500)
  await expect(fetch(endpoint.replace('/MCP', '/partial')).then(response => response.text())).rejects.toThrow()
  expect(warn).toHaveBeenCalledTimes(2)
})

it('releases an IPv6 loopback listener', async () => {
  const ctx = context()
  vi.mocked(createMcpHandler).mockReturnValue({
    async handle(_request, response) { response.writeHead(200).end('ready') },
    async close() {},
  })
  await ctx.plugin(SessionMcpServer, Config({ host: '::1', port: 0 } as Config))
  expect(ctx.sessionMcp.endpoint).toMatch(/^http:\/\/\[::1\]:\d+\/MCP$/u)
  expect(await (await fetch(ctx.sessionMcp.endpoint)).text()).toBe('ready')
})

it('drains a listener disposed before its bind callback settles', async () => {
  const ctx = context()
  const disposed: PromiseWithResolvers<void> = Promise.withResolvers()
  const close = vi.fn(async () => {})
  vi.mocked(createMcpHandler).mockImplementation(() => {
    queueMicrotask(() => { void ctx.fiber.dispose().then(disposed.resolve, disposed.reject) })
    return { async handle() {}, close }
  })
  const fiber = ctx.plugin(SessionMcpServer, Config({ port: 0 } as Config))
  await Promise.allSettled([fiber, disposed.promise])
  expect(close).toHaveBeenCalledOnce()
  expect(ctx.get('sessionMcp')).toBeUndefined()
})
