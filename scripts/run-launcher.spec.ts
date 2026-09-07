/** Windows launcher checks preserve listeners owned by other application instances. */
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const launcher = readFileSync(resolve(import.meta.dirname, '../RUN.bat'), 'utf8')

describe.skipIf(process.platform !== 'win32')('Windows web launcher', () => {
  it.each([
    { query: '@()', status: 0, error: undefined },
    { query: "throw 'listener enumeration unavailable'", status: 1, error: 'listener enumeration unavailable' },
  ])('returns $status when listener enumeration evaluates $query', ({ query, status, error }) => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-launcher-query-'))
    try {
      const command = launcher.split(/\r?\n/).find(line => line.includes('Get-NetTCPConnection'))
      expect(command).toBeDefined()
      const script = command!.replace(/^powershell -NoProfile -Command "/, '').replace(/"$/, '')
      const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `function Get-NetTCPConnection { param($State, $ErrorAction) ${query} }; ${script}`], {
        encoding: 'utf8',
        env: { SystemRoot: process.env.SystemRoot, PORT: '3080', LOG: join(root, 'run.log') },
        timeout: 30_000,
      })
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status).toBe(status)
      if (error !== undefined) {
        expect(result.stdout).toContain(error)
        expect(readFileSync(join(root, 'run.log'), 'utf8')).toContain(error)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses an occupied port before install or build and leaves its owner running', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-launcher-'))
    const env = {
      SystemRoot: process.env.SystemRoot,
      ComSpec: process.env.ComSpec,
      PATH: `${root};${process.env.SystemRoot}\\System32;${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0`,
      APPDATA: root,
      TEMP: root,
      TMP: root,
    }
    const listener = spawn(process.execPath, ['-e', 'require("node:net").createServer().listen(0, "127.0.0.1", function () { console.log(this.address().port) })'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const closed = once(listener, 'close')
    try {
      const [output] = await once(listener.stdout, 'data') as [Buffer]
      const port = Number(output.toString().trim())
      expect(port).toBeGreaterThan(0)
      writeFileSync(join(root, 'RUN.bat'), launcher.replace('set "PORT=3080"', `set "PORT=${port}"`))
      writeFileSync(join(root, 'pnpm.cmd'), '@echo off\r\necho %*>>pnpm-called.txt\r\nexit /b 0\r\n')
      const result = spawnSync(env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'RUN.bat'], {
        cwd: root,
        env,
        encoding: 'utf8',
        input: '\r\n',
        timeout: 30_000,
      })
      expect(result.error).toBeUndefined()
      expect(result.signal).toBeNull()
      expect(result.status).toBe(1)
      expect(result.stdout).toContain('Port is already occupied')
      expect(result.stdout).toContain('press Ctrl+C in its console')
      expect(existsSync(join(root, 'pnpm-called.txt'))).toBe(false)
      expect(readFileSync(join(root, 'run.log'), 'utf8')).toContain('Port is already occupied')
      expect(() => process.kill(listener.pid!, 0)).not.toThrow()
    } finally {
      listener.kill()
      await closed
      rmSync(root, { recursive: true, force: true })
    }
  })
})
