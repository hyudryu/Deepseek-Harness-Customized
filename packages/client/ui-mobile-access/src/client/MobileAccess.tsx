/** Desktop pairing dialog; server responses own the enabled state. */
import { useEffect, useState } from 'react'
import { Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './MobileAccess.module.css'

/** Authoritative listener status returned by the mobile access endpoint. */
export interface MobileAccessStatus { enabled: boolean; url: string | null }
/** Commands supplied by the plugin registration. */
export interface MobileAccessInjected {
  read: () => Promise<MobileAccessStatus>
  update: (enabled: boolean) => Promise<MobileAccessStatus>
  qr: (url: string) => Promise<string>
}
/** Framework shares and pairing commands for the Settings-adjacent action. */
export type MobileAccessProps = PropsRuntime<'sidebar.settings.action'> & PropsLocale<'mobileAccess'> & MobileAccessInjected

/** Render a phone icon and the pairing controls it opens.
 * @param props - Framework locale and injected server commands.
 * @returns Settings-adjacent button and body-portaled dialog.
 */
export function MobileAccess({ read, update, qr, t }: MobileAccessProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<MobileAccessStatus | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [qrError, setQrError] = useState(false)
  useEffect(() => {
    if (!open) return
    let current = true
    setStatus(null)
    setError(false)
    void read().then((value) => { if (current) setStatus(value) }, () => { if (current) setError(true) })
    return () => { current = false }
  }, [open, read])
  useEffect(() => {
    let current = true
    setCode(null)
    setQrError(false)
    if (open && status?.enabled === true && status.url !== null) {
      void qr(status.url).then((value) => { if (current) setCode(value) }, () => { if (current) setQrError(true) })
    }
    return () => { current = false }
  }, [open, status, qr])
  const toggle = async () => {
    if (status === null || pending) return
    setPending(true)
    setError(false)
    try { setStatus(await update(!status.enabled)) }
    catch { setError(true) } // Request failures leave the last confirmed listener state visible.
    finally { setPending(false) }
  }
  return <>
    <Tooltip label={t('title')}>
      <button type="button" className={css.trigger} aria-label={t('title')} onClick={() => { setOpen(true) }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 18h4" /></svg>
      </button>
    </Tooltip>
    <Modal open={open} onClose={() => { if (!pending) setOpen(false) }} title={t('title')} closeLabel={t('close')} className={css.dialog ?? ''}>
      {status === null && !error && <p role="status">{t('loading')}</p>}
      {status !== null && <label className={css.toggle}>
        <span>{t('enabled')}</span>
        <input type="checkbox" role="switch" checked={status.enabled} disabled={pending} onChange={() => { void toggle() }} />
      </label>}
      {pending && <p role="status">{t('pending')}</p>}
      {error && <p role="alert">{t('error')}</p>}
      {status?.enabled === true && status.url !== null ? <div className={css.pairing}>
        <p>{t('description')}</p>
        {code !== null && <img src={code} alt={t('qr')} width="256" height="256" />}
        {qrError && <p role="alert">{t('qrError')}</p>}
        <a href={status.url} target="_blank" rel="noreferrer">{t('link')}</a>
        <code>{new URL(status.url).origin}</code>
      </div> : status !== null && <p>{t('off')}</p>}
      <p className={css.note}>{t('restart')}</p>
    </Modal>
  </>
}
