/** RFC-derived codes and durable mutations use isolated, disposable account documents. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Secret } from 'otpauth'
import { AuthenticatorStore } from '../src/store.ts'

const paths: string[] = []
const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const uri = `otpauth://totp/Example:alice?secret=${secret}&issuer=Example`
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-authenticator-'))
  paths.push(directory)
  const filename = join(directory, 'private', 'accounts.json')
  return { filename, store: new AuthenticatorStore(filename) }
}

it('matches RFC 6238 SHA1 vectors truncated to six digits and preserves leading zeroes', async () => {
  const { store } = await fixture()
  const account = await store.importUri(uri)
  for (const [seconds, code] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']] as const) {
    const value = await store.getCode(account.id, seconds * 1000)
    expect(value.code).toBe(code)
    expect(value.validUntil).toBe((Math.floor(seconds / 30) + 1) * 30_000)
  }
  expect(JSON.stringify(await store.codes())).not.toContain(secret)
  expect(JSON.stringify(await store.list())).not.toContain('otpauth')
})

it('persists imports across instances, refuses duplicates, and permanently removes an account', async () => {
  const { store, filename } = await fixture()
  const account = await store.importUri(uri)
  const reopened = new AuthenticatorStore(filename)
  expect(await reopened.list()).toEqual([account])
  await expect(reopened.importUri(uri)).rejects.toThrow('already stored')
  expect(await reopened.remove(account.id)).toBe(true)
  expect(await store.list()).toEqual([])
  expect(await store.remove(account.id)).toBe(false)
  await expect(store.getCode(account.id)).rejects.toThrow('not found')
  expect(await readFile(filename, 'utf8')).not.toContain(secret)
})

it('matches the supported SHA256 and SHA512 RFC vectors at the time-step boundary', async () => {
  const { store } = await fixture()
  for (const [algorithm, length, code] of [['SHA256', 32, '119246'], ['SHA512', 64, '693936']] as const) {
    const key = Secret.fromUTF8('1234567890'.repeat(7).slice(0, length)).base32
    const account = await store.importUri(`otpauth://totp/${algorithm}?secret=${key}&algorithm=${algorithm}`)
    expect((await store.getCode(account.id, 59_000)).code).toBe(code)
    expect((await store.getCode(account.id, 60_000)).validUntil).toBe(90_000)
  }
})

it('samples the clock after asynchronous storage work so rollover does not return an expired code', async () => {
  const { store } = await fixture()
  const account = await store.importUri(uri)
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    vi.setSystemTime(59_000)
    const code = store.getCode(account.id)
    vi.setSystemTime(60_000)
    expect((await code).validUntil).toBe(90_000)
    vi.setSystemTime(89_000)
    const codes = store.codes()
    vi.setSystemTime(90_000)
    expect((await codes)[0]?.validUntil).toBe(120_000)
  } finally { vi.useRealTimers() }
})

it('serializes concurrent writers without dropping accounts', async () => {
  const { store, filename } = await fixture()
  const other = new AuthenticatorStore(filename)
  await Promise.all([store.importUri(uri), other.importUri('otpauth://totp/Other:bob?secret=JBSWY3DPEHPK3PXP&issuer=Other')])
  expect(await store.list()).toHaveLength(2)
})

it('rejects unsupported QR payloads without echoing secret material', async () => {
  const { store } = await fixture()
  for (const bad of [uri.replace('/totp/', '/hotp/'), uri + '&digits=8', uri + '&algorithm=MD5', 'https://example.com/' + secret, 'otpauth-migration://offline?data=' + secret]) {
    try { await store.importUri(bad); throw new Error('expected rejection') } catch (error) {
      expect(String(error)).not.toContain(secret)
      expect(String(error)).not.toContain('expected rejection')
    }
  }
  expect(await store.list()).toEqual([])
})

it('refuses malformed periods instead of truncating them or selecting a default', async () => {
  const { store } = await fixture()
  for (const period of ['0', '-30', '30seconds', '30.5', '']) {
    await expect(store.importUri(uri + '&period=' + period)).rejects.toThrow('positive integer')
  }
})

it('rejects missing secrets and ambiguous duplicate parameters without generating a random account', async () => {
  const { store } = await fixture()
  for (const bad of ['otpauth://totp/Example:alice', 'otpauth://totp/Example:alice?secret=', uri + '&secret=JBSWY3DPEHPK3PXP']) {
    await expect(store.importUri(bad)).rejects.toThrow(/no secret|duplicate parameters/)
  }
  expect(await store.list()).toEqual([])
})

it('preserves invalid durable input and redacts schema diagnostics', async () => {
  const { store, filename } = await fixture()
  await store.importUri(uri)
  await writeFile(filename, '{"version":99,"secret":"DO-NOT-ECHO"}', { mode: 0o600 })
  await expect(store.list()).rejects.toThrow('existing file was preserved')
  await expect(store.importUri(uri)).rejects.toThrow('existing file was preserved')
  expect(await readFile(filename, 'utf8')).toContain('DO-NOT-ECHO')
})
