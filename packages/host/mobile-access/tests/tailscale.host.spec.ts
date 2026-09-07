/** Tailscale discovery trusts named interfaces or a locally assigned official CLI result. */
import { expect, it, vi, beforeEach } from 'vitest'
import { tailscaleAddress } from '../src/tailscale.ts'

const external = vi.hoisted(() => ({ interfaces: vi.fn(), command: vi.fn() }))
vi.mock('node:os', () => ({ networkInterfaces: external.interfaces }))
vi.mock('node:child_process', () => {
  const execFile = Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: external.command })
  return { execFile }
})
const config = { tailscaleExecutable: 'tailscale', discoveryTimeoutMs: 3000 }
beforeEach(() => { external.interfaces.mockReset(); external.command.mockReset() })

it('uses the active named Tailscale IPv4 interface', async () => {
  external.interfaces.mockReturnValue({ Tailscale: [{ address: '100.100.1.2', internal: false }] })
  expect(await tailscaleAddress(config)).toBe('100.100.1.2')
  expect(external.command).not.toHaveBeenCalled()
})

it('accepts official CLI discovery only for an assigned tailnet address', async () => {
  external.interfaces.mockReturnValue({ utun4: [{ address: '100.100.1.2', internal: false }] })
  external.command.mockResolvedValue({ stdout: '100.100.1.2\n' })
  expect(await tailscaleAddress(config)).toBe('100.100.1.2')
  expect(external.command).toHaveBeenCalledWith('tailscale', ['ip', '-4'], expect.objectContaining({ timeout: 3000, windowsHide: true }))
  external.command.mockResolvedValue({ stdout: '100.100.1.3\n' })
  await expect(tailscaleAddress(config)).rejects.toThrow('no active local IPv4')
})

it('rejects LAN addresses and failed discovery instead of widening the listener', async () => {
  external.interfaces.mockReturnValue({ Tailscale: [{ address: '192.168.1.2', internal: false }], TailscaleOffline: undefined })
  external.command.mockResolvedValue({ stdout: '192.168.1.2\n' })
  await expect(tailscaleAddress(config)).rejects.toThrow('no active local IPv4')
  external.command.mockRejectedValue(new Error('missing executable'))
  await expect(tailscaleAddress(config)).rejects.toThrow('missing executable')
})
