/**
 * Top-right browser toggle. Starting reveals the current session's browser;
 * collapsing leaves its page running.
 */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './BrowserPanel.module.css'

/** Session browser actions and the layout's rendered panel visibility. */
export type StartBrowserDockProps = {
  /** Open a browser for the current session and reveal the panel. */
  start: (url?: string) => Promise<void>
  expanded: boolean
  closePanel: () => void
} & PropsLocale<'browser'>

/**
 * Render the browser toggle with pending and error feedback.
 * @param props - session actions, visibility, and localized copy.
 * @returns the icon button and any start error.
 */
export function StartBrowserDock({ start, expanded, closePanel, t }: StartBrowserDockProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const toggle = async () => {
    if (expanded) { closePanel(); return }
    setPending(true)
    setError('')
    try { await start() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
  }
  return (
    <>
      <button type="button" className={css.toggleButton} disabled={pending}
        aria-label={expanded ? t('closePanel') : t('start')} title={expanded ? t('closePanel') : t('start')}
        aria-expanded={expanded} onClick={() => void toggle()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M15 4v16" />
        </svg>
      </button>
      {error !== '' && <div role="alert" className={css.error}>{t('errorStart')}: {error}</div>}
    </>
  )
}
