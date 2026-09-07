/**
 * The bundle's substance is its patch file: the `dsh.bundle.patch` manifest
 * field must name a real, parseable patch list.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'

describe('dsh-base bundle', () => {
  it('declares a parseable patch list through the dsh.bundle.patch manifest field', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    // The base layer is one insert list over the empty profile root.
    const rows = (parsed as { insert?: { id?: string; config?: Record<string, unknown>; disabled?: boolean }[] }[]).flatMap(
      patch => patch.insert ?? [],
    )
    expect(rows.length).toBeGreaterThan(50)
    expect(rows.some(row => row.id === 'agent-loop')).toBe(true)
    expect(rows.find(row => row.id === 'session-telemetry-otel')?.config?.['mode']).toEqual({
      __jsExpr: "process.env.DSH_TELEMETRY_MODE || 'FEEDBACK_ONLY'",
    })
    expect(rows.find(row => row.id === 'hmr')).toMatchObject({
      disabled: true,
      config: { root: ['.'] },
    })
    expect(rows.filter(row => row.id === 'subagent-codex')).toHaveLength(0)
    expect(rows.filter(row => row.id === 'subagent-claude-code')).toHaveLength(0)
    expect(rows.find(row => row.id === 'web')?.config).toMatchObject({ fetchProvider: 'http' })
    expect(rows.find(row => row.id === 'web-fetch-http')).toBeDefined()
    expect(rows.find(row => row.id === 'tool-web')?.config).toMatchObject({ fetch: true })
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-subagent-codex')
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-subagent-claude-code')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-web-fetch-http')
  })

  it('gates each shell stack by platform with a symmetric disabled expression', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const parsed = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new TypeError('base patch must parse to a patch list')
    const rows = parsed.flatMap((patch): Record<string, unknown>[] =>
      typeof patch === 'object' && patch !== null
        ? (patch as { insert?: Record<string, unknown>[] }).insert ?? []
        : [],
    )
    // Symmetric gating: each stack's executor and tool rows carry the same
    // platform fact, inverted between the bash and pwsh twins, so exactly one
    // shell stack mounts per host. Evaluate with a platform-scoped context
    // (the `with` scope shadows the global `process`) so both outcomes pin on
    // every host.
    for (const [id, win32, linux] of [
      ['bash-sandbox', true, false],
      ['tool-bash', true, false],
      ['pwsh-sandbox', false, true],
      ['tool-pwsh', false, true],
    ] as const) {
      const row = rows.find(candidate => candidate.id === id)
      if (row === undefined) throw new Error(`base patch must mount ${id}`)
      const expression = (row.disabled as { __jsExpr?: string } | undefined)?.__jsExpr
      if (expression === undefined) throw new Error(`${id} must gate on a !!js disabled expression`)
      expect(Boolean(evaluate({ process: { platform: 'win32' } }, expression)), `${id} on win32`).toBe(win32)
      expect(Boolean(evaluate({ process: { platform: 'linux' } }, expression)), `${id} on linux`).toBe(linux)
    }
    // The platform layer folded into these rows: no separate patch file ships.
    expect(existsSync(resolve(root, 'windows.cordis.patch.yml'))).toBe(false)
  })
})

/** App rows wait for the MCP listener after command-line acceptance. */
describe('session MCP profile startup', () => {
  function patches(bundle: string): {
    id?: string
    inject?: string[]
    config?: Record<string, unknown>
    insert?: { id?: string; name?: string; inject?: string[]; config?: Record<string, unknown> }[]
  }[] {
    return yaml.load(readFileSync(new URL(`../../${bundle}/cordis.patch.yml`, import.meta.url), 'utf8'), {
      schema: entryListSchema,
    }) as ReturnType<typeof patches>
  }

  it.each([
    ['headless', 'headlessStartup', 'headless-runner'],
    ['sdk-app', 'sdkAppStartup', 'sdk-jsonrpc-server'],
    ['acp-app', 'acpAppStartup', 'acp'],
  ])('gates %s MCP and its application on accepted startup', (bundle, startup, app) => {
    const rows = patches(bundle!)
    expect(rows.find(row => row.id === 'session-mcp')?.inject).toContain(startup)
    expect(rows.flatMap(row => row.insert ?? []).find(row => row.id === app)?.inject).toContain('sessionMcp')
  })

  it('shares the Web listener and waits for its workspace registry', () => {
    expect(patches('web-app').find(row => row.id === 'session-mcp')).toMatchObject({
      inject: ['webStartup', 'webServer', 'workspaceRegistry'],
      config: { transport: 'web-server', path: '/MCP' },
    })
  })

  it('mounts standalone MCP and exact session reads in SDK minimal', () => {
    const rows = patches('sdk-minimal').flatMap(row => row.insert ?? [])
    expect(rows.find(row => row.id === 'session-mcp')).toMatchObject({
      name: '@deepseek-ai/dsh-session-mcp', inject: ['sdkAppStartup'],
      config: { transport: 'standalone', path: '/MCP' },
    })
    expect(rows.find(row => row.id === 'session-query-sqlite')).toMatchObject({
      name: '@deepseek-ai/dsh-session-query-sqlite', config: { openAt: 'never' },
    })
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')?.inject).toContain('sessionMcp')
  })

  it('defaults to port 3080 and accepts an explicit OS-assigned port', () => {
    const row = patches('base').flatMap(patch => patch.insert ?? []).find(candidate => candidate.id === 'session-mcp')
    const expression = (row?.config?.port as { __jsExpr: string }).__jsExpr
    expect(evaluate({ process: { env: {} } }, expression)).toBe(3080)
    expect(evaluate({ process: { env: { DSH_SESSION_MCP_PORT: '0' } } }, expression)).toBe(0)
  })
})
