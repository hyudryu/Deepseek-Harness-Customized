/** Authenticated HTTP operations injected into the account presentation. */
import { AuthenticatorRequestError, parseAccounts, parseDeleted, parseImported, type Account } from './wire.ts'

/** Validated account operations supplied to the configuration card. */
interface AuthenticatorActions {
  loadAccounts: (signal: AbortSignal) => Promise<Account[]>
  importAccount: (uri: string) => Promise<void>
  deleteAccount: (id: string) => Promise<void>
}

/**
 * Create account read and mutation callbacks at the slot registrant.
 * @returns Validated account operations with cancellation for polling reads.
 */
export function createAuthenticatorActions(): AuthenticatorActions {
  const mutate = async (path: string, body: Record<string, string>) => {
    const response = await fetch(path, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!response.ok) throw new AuthenticatorRequestError(await response.json())
    return await response.json() as unknown
  }
  return {
    loadAccounts: async (signal: AbortSignal) => {
      const response = await fetch('/authenticator', { credentials: 'same-origin', cache: 'no-store', signal })
      if (!response.ok) throw new Error('request-failed')
      return parseAccounts(await response.json())
    },
    importAccount: async (uri: string) => { parseImported(await mutate('/authenticator/import', { uri })) },
    deleteAccount: async (id: string) => { parseDeleted(await mutate('/authenticator/delete', { id })) },
  }
}
