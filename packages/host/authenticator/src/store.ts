/** Durable local TOTP accounts. Public projections never contain provisioning secrets. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { TOTP, URI } from 'otpauth'
import { z } from 'zod'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Durable opaque identity of one authenticator account. */
export type AuthenticatorAccountId = Branded<'AuthenticatorAccountId'>
const idSchema = z.uuid().transform(value => value as AuthenticatorAccountId)

const accountSchema = z.object({
  id: idSchema, label: z.string().min(1), issuer: z.string(),
  secret: z.string().regex(/^[A-Z2-7]+$/), algorithm: z.enum(['SHA1', 'SHA256', 'SHA512']),
  period: z.number().int().positive().max(3600),
}).strict()
const documentSchema = z.object({ version: z.literal(1), accounts: z.array(accountSchema) }).strict()
type Account = z.infer<typeof accountSchema>

/** Account identity and timing, safe to display without its provisioning secret. */
export interface AccountInfo {
  id: AuthenticatorAccountId
  label: string
  issuer: string
  period: number
}

/** Current six-digit value and its expiry in Unix milliseconds. */
export interface AccountCode extends AccountInfo {
  code: string
  validUntil: number
}

/** Stable diagnostic categories for locale-owned account management messages. */
export type AccountErrorCode = 'invalid-request' | 'invalid-provisioning' | 'unsupported-provisioning'
  | 'duplicate-account' | 'account-not-found'

/** Expected account/provisioning errors safe to return to authenticated callers. */
export class AccountError extends Error {
  /** Stable category used by the browser locale dictionary. */
  readonly code: AccountErrorCode

  constructor(message: string, code: AccountErrorCode = 'invalid-provisioning') {
    super(message)
    this.code = code
  }
}

/**
 * Validate an account identity arriving from HTTP, MCP or model tool arguments.
 * @param value - untrusted account identity.
 * @returns a validated opaque account id.
 */
export function parseAccountId(value: unknown): AuthenticatorAccountId {
  const result = idSchema.safeParse(value)
  if (!result.success) throw new AccountError('Expected an authenticator account id', 'invalid-request')
  return result.data
}

function publicInfo(account: Account): AccountInfo {
  const { id, label, issuer, period } = account
  return { id, label, issuer, period }
}

function parseUri(uri: string): Omit<Account, 'id'> {
  if (uri.length > 8192) throw new AccountError('Authenticator URI is too large')
  let url: URL
  try { url = new URL(uri) } catch { throw new AccountError('The QR code does not contain an authenticator URI') }
  if (url.protocol !== 'otpauth:' || url.hostname !== 'totp') {
    throw new AccountError('Only otpauth TOTP QR codes are supported; HOTP and migration exports are not supported', 'unsupported-provisioning')
  }
  if (url.searchParams.has('digits') && url.searchParams.get('digits') !== '6') {
    throw new AccountError('Only six-digit authenticator codes are supported', 'unsupported-provisioning')
  }
  if (!url.searchParams.get('secret')?.trim()) throw new AccountError('The authenticator QR code has no secret')
  const period = url.searchParams.get('period')
  if (period !== null && !/^[1-9]\d*$/.test(period)) throw new AccountError('The authenticator period must be a positive integer')
  if (Array.from(url.searchParams.keys()).some(key => url.searchParams.getAll(key).length !== 1)) {
    throw new AccountError('The authenticator QR code contains duplicate parameters')
  }
  let otp: TOTP
  try {
    const parsed = URI.parse(uri)
    if (!(parsed instanceof TOTP)) throw new Error('not TOTP')
    otp = parsed
  } catch { throw new AccountError('Invalid TOTP provisioning data') }
  const result = accountSchema.omit({ id: true }).safeParse({
    label: otp.label.trim(), issuer: otp.issuer, secret: otp.secret.base32,
    algorithm: otp.algorithm, period: otp.period,
  })
  if (!result.success) throw new AccountError('Unsupported TOTP algorithm, account name, or period', 'unsupported-provisioning')
  return result.data
}

/** Protect newly created account directories before writing any secret bytes. */
async function protectDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') return
  const run = promisify(execFile)
  const options = { windowsHide: true, timeout: 10_000 }
  const { stdout } = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], options)
  const sid = stdout.match(/S-1-[\d-]+/)?.[0]
  if (sid === undefined) throw new Error('Cannot determine the Windows account owning authenticator storage')
  await run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], options)
}

/** Atomic account reads and cross-process serialized mutations. */
export class AuthenticatorStore {
  private ready: Promise<void> | undefined

  /** @param filename - dedicated account document outside the repository. */
  constructor(private readonly filename: string) {}

  private prepare(): Promise<void> {
    return this.ready ??= protectDirectory(dirname(this.filename))
  }

  private async read(): Promise<Account[]> {
    await this.prepare()
    let text: string
    try { text = await readFile(this.filename, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    if (process.platform !== 'win32' && ((await stat(this.filename)).mode & 0o077) !== 0) {
      throw new Error('Authenticator storage must have owner-only permissions (chmod 600)')
    }
    try { return documentSchema.parse(JSON.parse(text)).accounts } catch {
      throw new Error('Authenticator storage is invalid; the existing file was preserved')
    }
  }

  /**
   * Discover stored accounts.
   * @returns account metadata without codes or provisioning secrets.
   */
  async list(): Promise<AccountInfo[]> {
    return (await this.read()).map(publicInfo)
  }

  /**
   * Read the Settings account list with current codes.
   * @param now - Unix milliseconds used for one coherent snapshot.
   * @returns accounts with current codes.
   */
  async codes(now?: number): Promise<AccountCode[]> {
    const accounts = await this.read()
    const timestamp = now ?? Date.now()
    return accounts.map(account => this.code(account, timestamp))
  }

  /**
   * Generate one account's current code.
   * @param id - stored account id.
   * @param now - Unix milliseconds.
   * @returns the current code and expiry.
   */
  async getCode(id: AuthenticatorAccountId, now?: number): Promise<AccountCode> {
    const account = (await this.read()).find(item => item.id === id)
    if (account === undefined) throw new AccountError('Authenticator account was not found', 'account-not-found')
    return this.code(account, now ?? Date.now())
  }

  private code(account: Account, now: number): AccountCode {
    const otp = new TOTP({ ...account, digits: 6 })
    return { ...publicInfo(account), code: otp.generate({ timestamp: now }),
      validUntil: (Math.floor(now / (account.period * 1000)) + 1) * account.period * 1000 }
  }

  /**
   * Persist one new account, rejecting duplicate identity or secret.
   * @param uri - decoded standard TOTP provisioning URI.
   * @returns newly stored account metadata.
   */
  async importUri(uri: string): Promise<AccountInfo> {
    const parsed = parseUri(uri)
    await this.prepare()
    return withFileLock(this.filename, async () => {
      const accounts = await this.read()
      if (accounts.some(account => account.secret === parsed.secret
        || (account.label === parsed.label && account.issuer === parsed.issuer))) {
        throw new AccountError('This authenticator account is already stored; delete it before replacing it', 'duplicate-account')
      }
      const account = { ...parsed, id: parseAccountId(randomUUID()) }
      await this.write([...accounts, account])
      return publicInfo(account)
    })
  }

  /**
   * Remove one account from the durable document.
   * @param id - account to delete.
   * @returns whether an account was removed.
   */
  async remove(id: AuthenticatorAccountId): Promise<boolean> {
    await this.prepare()
    return withFileLock(this.filename, async () => {
      const accounts = await this.read()
      const remaining = accounts.filter(account => account.id !== id)
      if (remaining.length === accounts.length) return false
      await this.write(remaining)
      return true
    })
  }

  private async write(accounts: Account[]): Promise<void> {
    await writeFileAtomic(this.filename, JSON.stringify({ version: 1, accounts }) + '\n', { mode: 0o600, dirMode: 0o700 })
  }
}
