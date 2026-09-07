/** Local interface and official CLI discovery for Tailscale. */
import { networkInterfaces } from 'node:os'
import { isIP } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Config } from './index.ts'

function isTailnetIPv4(address: string): boolean {
  const parts = address.split('.')
  return isIP(address) === 4 && parts[0] === '100' && Number(parts[1]) >= 64 && Number(parts[1]) <= 127
}

/**
 * Discover a locally assigned Tailscale IPv4 address.
 * @param config - official CLI path and execution deadline.
 * @returns locally assigned tailnet IPv4 address.
 */
export async function tailscaleAddress(config: Config): Promise<string> {
  const interfaces = Object.entries(networkInterfaces())
  const named = interfaces.flatMap(([name, entries]) => /^tailscale/i.test(name)
    ? (entries ?? []).filter(entry => !entry.internal && isTailnetIPv4(entry.address)) : [])
  const [first] = named
  if (named.length === 1 && first !== undefined) return first.address
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP)$/i.test(key)))
  const { stdout } = await promisify(execFile)(config.tailscaleExecutable, ['ip', '-4'], {
    timeout: config.discoveryTimeoutMs, windowsHide: true, maxBuffer: 4096, env,
  })
  const address = stdout.trim()
  const assigned = interfaces.some(([, entries]) => entries?.some(entry => entry.address === address && !entry.internal))
  if (!isTailnetIPv4(address) || !assigned) throw new Error('Tailscale has no active local IPv4 address')
  return address
}
