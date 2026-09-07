/** Installs and imports the checkout's standalone custom plugins before application startup. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const plugins = join(root, 'Custom Plugins')
const pnpm = process.env.npm_execpath
if (!pnpm || !existsSync(pnpm)) {
  throw new Error('Run this installer with pnpm run install:custom-plugins.')
}

for (const entry of readdirSync(plugins, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue
  const directory = join(plugins, entry.name)
  const manifestPath = join(directory, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest.main !== 'string') throw new Error(`${manifestPath}: custom plugin must declare its main entry.`)
  console.log(`Installing custom plugin: ${manifest.name}`)
  const installed = spawnSync(process.execPath, [pnpm, 'install', '--ignore-workspace', '--frozen-lockfile'], {
    cwd: directory,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
  })
  if (installed.error) throw installed.error
  if (installed.status !== 0) {
    throw new Error(`${manifest.name}: dependency installation failed (${installed.status ?? installed.signal}).`)
  }
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(process.argv[1])', pathToFileURL(resolve(directory, manifest.main)).href], {
    cwd: directory,
    stdio: 'inherit',
  })
  if (imported.error) throw imported.error
  if (imported.status !== 0) {
    throw new Error(`${manifest.name}: plugin import failed (${imported.status ?? imported.signal}); application startup stopped.`)
  }
}
