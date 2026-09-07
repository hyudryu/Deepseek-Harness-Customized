/** Expandable authenticator accounts, QR import, and deletion controls. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './index.ts'
import { readAuthenticatorQr } from './qr.ts'
import { AuthenticatorRequestError, type Account } from './wire.ts'
import type { createAuthenticatorActions } from './actions.ts'
import css from './AuthenticatorCard.module.css'

type AuthenticatorCardProps = PropsLocale<'authenticator'> & ReturnType<typeof createAuthenticatorActions>

/**
 * Render account management without exposing provisioning secrets.
 * @param props - localized configuration copy.
 * @returns a collapsible plugin card.
 */
export function AuthenticatorCard({ t, loadAccounts, importAccount, deleteAccount }: AuthenticatorCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState(false)
  const [notice, setNotice] = useState('')
  const [confirmId, setConfirmId] = useState<string>()
  const [now, setNow] = useState(Date.now())
  const [revision, setRevision] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!expanded) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setNow(Date.now())
    const clock = setInterval(() => { setNow(Date.now()) }, 1000)
    const refresh = async () => {
      try {
        const result = await loadAccounts(abort.signal)
        if (!abort.signal.aborted) { setAccounts(result); setNow(Date.now()); setLoading(false); setPollError(false) }
      } catch {
        // Aborted polls belong to the collapsed or replaced card; only active failures render.
        if (!abort.signal.aborted) { setPollError(true); setLoading(false) }
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(() => { void refresh() }, 1000)
      }
    }
    void refresh()
    return () => { abort.abort(); clearTimeout(timer); clearInterval(clock) }
  }, [expanded, revision, loadAccounts])

  const importFile = async (file: File) => {
    setPending(true); setError(''); setNotice('')
    let uri: string
    try { uri = await readAuthenticatorQr(file) }
    catch { setError(t('invalidQr')); setPending(false); return }
    try { await importAccount(uri); setRevision(value => value + 1); setNotice(t('imported')) }
    catch (error) { setError(t(error instanceof AuthenticatorRequestError ? error.localeKey : 'failed')) }
    finally { setPending(false) }
  }
  const remove = async (id: string) => {
    setPending(true); setError(''); setNotice('')
    try { await deleteAccount(id); setRevision(value => value + 1); setConfirmId(undefined); setNotice(t('deleted')) }
    catch (error) { setError(t(error instanceof AuthenticatorRequestError ? error.localeKey : 'failed')) }
    finally { setPending(false) }
  }
  return (
    <li className={css.card}>
      <button type="button" className={css.heading} aria-expanded={expanded} onClick={() => { setExpanded(value => !value) }}>
        <strong>{t('title')}</strong><span>{t('description')}</span>
      </button>
      {expanded && <div className={css.body}>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label={t('import')} className={css.file}
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file) }} />
        <button type="button" className={css.button} disabled={pending} onClick={() => input.current?.click()}>{t('import')}</button>
        {(error || pollError) && <p role="alert">{error || t('failed')}</p>}
        {notice && <p role="status">{notice}</p>}
        {loading ? <p>{t('loading')}</p> : accounts.length === 0 ? <p>{t('empty')}</p> : <ul className={css.accounts}>
          {accounts.map(account => <li key={account.id} className={css.account}>
            <div className={css.identity}><strong>{account.label}</strong><span>{account.issuer}</span></div>
            <div className={css.verification}><output aria-label={account.label}>{account.validUntil > now ? account.code : t('expired')}</output><small>{Math.max(0, Math.ceil((account.validUntil - now) / 1000))} {t('expires')}</small></div>
            {confirmId === account.id ? <div className={css.confirm}><span>{t('confirm')}</span>
              <button type="button" className={css.button} disabled={pending} onClick={() => void remove(account.id)}>{t('remove')}</button>
              <button type="button" className={css.button} onClick={() => { setConfirmId(undefined) }}>{t('cancel')}</button>
            </div> : <button type="button" className={css.button} disabled={pending} aria-label={`${t('remove')} ${account.label}`} onClick={() => { setConfirmId(account.id) }}>{t('remove')}</button>}
          </li>)}
        </ul>}
      </div>}
    </li>
  )
}
