/** Executable defaults follow the operating system; an explicit path stays configurable. */
import { expect, it, vi } from 'vitest'

it('uses the standard Windows install directory when ProgramFiles is absent', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  const programFiles = process.env.ProgramFiles
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    delete process.env.ProgramFiles
    vi.resetModules()
    const { Config } = await import('../src/index.ts')
    expect(Config({}).tailscaleExecutable).toContain('Tailscale')
    process.env.ProgramFiles = 'C:/Applications'
    vi.resetModules()
    const configured = await import('../src/index.ts')
    expect(configured.Config({}).tailscaleExecutable).toContain('Applications')
    expect(configured.Config({ tailscaleExecutable: '/opt/tailscale' }).tailscaleExecutable).toBe('/opt/tailscale')
  } finally {
    Object.defineProperty(process, 'platform', platform)
    if (programFiles === undefined) delete process.env.ProgramFiles
    else process.env.ProgramFiles = programFiles
    vi.resetModules()
  }
})

it('uses PATH discovery on Unix hosts', async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    vi.resetModules()
    const { Config } = await import('../src/index.ts')
    expect(Config({}).tailscaleExecutable).toBe('tailscale')
  } finally {
    Object.defineProperty(process, 'platform', platform)
    vi.resetModules()
  }
})
