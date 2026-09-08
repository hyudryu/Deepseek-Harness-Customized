/** JSON response validation for authenticated account administration. */
import { z } from 'zod'
import type { AuthenticatorKey } from './locales.ts'

const errorCode = z.enum(['invalid-request', 'invalid-provisioning', 'unsupported-provisioning', 'duplicate-account', 'account-not-found', 'operation-failed'])
const errorKeys = {
  'invalid-request': 'invalidRequest',
  'invalid-provisioning': 'invalidProvisioning',
  'unsupported-provisioning': 'unsupportedProvisioning',
  'duplicate-account': 'duplicateAccount',
  'account-not-found': 'accountNotFound',
  'operation-failed': 'failed',
} satisfies Record<z.infer<typeof errorCode>, AuthenticatorKey>

/** Localizable endpoint failure; raw server error prose is never rendered. */
export class AuthenticatorRequestError extends Error {
  /** Locale-owned message selected from the endpoint's machine-readable error code. */
  readonly localeKey: AuthenticatorKey

  /**
   * Select a known localized error or the generic failure message.
   * @param value - Decoded error response from account administration.
   */
  constructor(value: unknown) {
    super('Authenticator request failed')
    const parsed = z.object({ errorCode }).safeParse(value)
    this.localeKey = parsed.success ? errorKeys[parsed.data.errorCode] : 'failed'
  }
}
const metadata = z.object({
  id: z.uuid(), label: z.string().min(1), issuer: z.string(), period: z.number().int().positive(),
})
const account = metadata.extend({ code: z.string().regex(/^\d{6}$/), validUntil: z.number().int().nonnegative() })
/** Public account code fields accepted from the server. */
export type Account = z.infer<typeof account>
/** Parse the account list without retaining extra wire fields.
 * @param value - Decoded endpoint JSON.
 * @returns Validated account projections.
 */
export function parseAccounts(value: unknown): Account[] { return z.object({ accounts: z.array(account) }).parse(value).accounts }
/** Validate an import acknowledgement before showing success.
 * @param value - Decoded import JSON.
 */
export function parseImported(value: unknown): void { metadata.parse(value) }
/** Validate a delete acknowledgement before showing success.
 * @param value - Decoded delete JSON.
 */
export function parseDeleted(value: unknown): void {
  const { removed } = z.object({ removed: z.boolean() }).parse(value)
  if (!removed) throw new AuthenticatorRequestError({ errorCode: 'account-not-found' })
}
