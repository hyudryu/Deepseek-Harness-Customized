/** Shipped Web profile assembly mounts browser controls only with the optional provider bundle. */
import { afterEach, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { composeEntries, initProfile, loadProfile, PROFILES_DIR, resolveBundleDir } from '@deepseek-ai/dsh-app-boot'

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
  const providerDir = resolveBundleDir('dsh', 'dsh-browser-control', anchor, profileDir)
  const providerAnchor = join(providerDir, 'package.json')
  const manifest = JSON.parse(readFileSync(providerAnchor, 'utf8')) as { dependencies: Record<string, string> }
  for (const name of browserNames.slice(1)) {
    expect(manifest.dependencies[name], `${name} in installation dependency closure`).toBeDefined()
    const searchPaths = createRequire(providerAnchor).resolve.paths(name) ?? []
    expect(searchPaths.some(path => existsSync(join(path, name, 'package.json'))), `${name} resolves from installed browser bundle`).toBe(true)
  }
})
