/** Exercises standalone plugin dependency installation and import before launcher startup. */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

function withCheckout(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'dsh custom plugins '))
  try {
    mkdirSync(join(root, 'scripts'))
    mkdirSync(join(root, 'Custom Plugins'))
    copyFileSync(new URL('./install-custom-plugins.mjs', import.meta.url), join(root, 'scripts', 'install-custom-plugins.mjs'))
    writeFileSync(join(root, 'fixture-pnpm.mjs'), `
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
appendFileSync(process.env.FIXTURE_CALLS, JSON.stringify({ name: manifest.name, args: process.argv.slice(2) }) + '\\n')
if (manifest.installFailure) process.exit(23)
const dependency = join('node_modules', 'fixture-dependency')
mkdirSync(dependency, { recursive: true })
writeFileSync(join(dependency, 'package.json'), JSON.stringify({ name: 'fixture-dependency', type: 'module', exports: './index.js' }))
writeFileSync(join(dependency, 'index.js'), 'export const installed = true\\n')
`)
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

function addPlugin(root: string, name: string, failure?: 'install' | 'import'): void {
  const directory = join(root, 'Custom Plugins', name)
  mkdirSync(directory)
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name,
    type: 'module',
    main: './index.js',
    installFailure: failure === 'install',
  }))
  writeFileSync(join(directory, 'index.js'), failure === 'import'
    ? "import 'missing-plugin-dependency'\n"
    : `import { installed } from 'fixture-dependency'
import { writeFileSync } from 'node:fs'
if (!installed) throw new Error('Dependency unavailable')
writeFileSync(new URL('./imported', import.meta.url), 'ready')
`)
}

function runInstaller(root: string, entrypoint = join(root, 'fixture-pnpm.mjs')) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'install-custom-plugins.mjs')], {
    // The installer must find its checkout from its own path, even outside the checkout cwd.
    cwd: tmpdir(),
    env: { ...process.env, npm_execpath: entrypoint, FIXTURE_CALLS: join(root, 'calls.jsonl') },
    encoding: 'utf8',
    timeout: 30_000,
  })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  return result
}

describe('standalone custom plugin installer', () => {
  it('executes native package-manager entrypoints directly', () => {
    withCheckout((root) => {
      addPlugin(root, 'native plugin')
      // Node supplies a real native executable on every test platform. Its install
      // script adapts the received arguments to the package-manager fixture.
      writeFileSync(join(root, 'Custom Plugins', 'native plugin', 'install'), `
process.argv.splice(1, 1, 'fixture-pnpm', 'install')
await import(${JSON.stringify(pathToFileURL(join(root, 'fixture-pnpm.mjs')).href)})
`)
      const result = runInstaller(root, process.execPath)
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(readFileSync(join(root, 'calls.jsonl'), 'utf8'))).toEqual({
        name: 'native plugin', args: ['install', '--ignore-workspace', '--frozen-lockfile'],
      })
      expect(readFileSync(join(root, 'Custom Plugins', 'native plugin', 'imported'), 'utf8')).toBe('ready')
    })
  })

  it('installs locked dependencies and imports each plugin from checkout paths containing spaces', () => {
    withCheckout((root) => {
      addPlugin(root, 'a first plugin')
      addPlugin(root, 'b second plugin')
      mkdirSync(join(root, 'Custom Plugins', 'documentation'))
      writeFileSync(join(root, 'Custom Plugins', 'README.md'), 'Standalone plugins\n')

      const result = runInstaller(root)

      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as unknown)).toEqual([
        { name: 'a first plugin', args: ['install', '--ignore-workspace', '--frozen-lockfile'] },
        { name: 'b second plugin', args: ['install', '--ignore-workspace', '--frozen-lockfile'] },
      ])
      for (const name of ['a first plugin', 'b second plugin']) {
        expect(readFileSync(join(root, 'Custom Plugins', name, 'imported'), 'utf8')).toBe('ready')
      }
    })
  })

  it.each(['install', 'import'] as const)('stops before later plugins when a plugin %s fails', (failure) => {
    withCheckout((root) => {
      addPlugin(root, 'a failing plugin', failure)
      addPlugin(root, 'b later plugin')

      const result = runInstaller(root)

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(failure === 'install' ? 'dependency installation failed (23)' : 'plugin import failed')
      expect(readFileSync(join(root, 'calls.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)
      expect(existsSync(join(root, 'Custom Plugins', 'a failing plugin', 'imported'))).toBe(false)
      expect(existsSync(join(root, 'Custom Plugins', 'b later plugin', 'node_modules'))).toBe(false)
    })
  })
})
