/** Shipped Web profile assembly mounts browser controls only with the optional provider bundle. */
import { afterEach, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries, initProfile, loadProfile, PROFILES_DIR } from '@deepseek-ai/dsh-app-boot'

const anchor = fileURLToPath(new URL('../../../package.json', import.meta.url))
const provider = fileURLToPath(new URL('../../../../../Custom Plugins/browser-control/', import.meta.url))
let home: string | undefined
let pluginLink: string | undefined
afterEach(() => {
  if (pluginLink !== undefined) unlinkSync(pluginLink)
  pluginLink = undefined
  if (home !== undefined) rmSync(home, { recursive: true, force: true })
  home = undefined
})

it.each([false, true])('composes the browser provider and both consumers together when enabled=%s', (enabled) => {
  home = mkdtempSync(join(tmpdir(), 'dsh-browser-profile-'))
  const profileDir = join(home, PROFILES_DIR, 'web')
  initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...enabled ? ['dsh-browser-control'] : []])
  if (enabled) {
    mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
    pluginLink = join(profileDir, 'node_modules', 'dsh-browser-control')
    symlinkSync(provider, pluginLink, 'junction')
  }
  const profile = loadProfile('dsh', 'web', anchor, home)
  const warnings: string[] = []
  const rows = composeEntries(profile.layers.map(layer => layer.patches), warning => warnings.push(warning))
  const browserNames = ['dsh-browser-control', '@deepseek-ai/dsh-api-browser-controller', '@deepseek-ai/dsh-client-ui-browser']
  const mounted = rows.filter(row => browserNames.includes(row.name ?? '') && row.disabled !== true)
  expect(mounted.map(row => row.name)).toEqual(enabled ? browserNames : [])
  expect(warnings).toEqual([])
  if (!enabled) return
  const manifest = JSON.parse(readFileSync(join(provider, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  for (const name of browserNames.slice(1)) {
    const dependency = manifest.dependencies[name]!
    expect(dependency, `${name} in optional bundle dependencies`).toMatch(/^link:/)
    const linked = JSON.parse(readFileSync(join(resolve(provider, dependency.slice(5)), 'package.json'), 'utf8')) as { name: string }
    expect(linked.name).toBe(name)
  }
})
