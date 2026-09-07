/**
 * Live per-session browser panel: the streamed page frame, the Playwright
 * action log, and a glowing cursor that shows the agent's click point and
 * follows the user's pointer over the viewport. All data arrives through the
 * injected session verbs; the component holds only transient viewing state.
 */
import { useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserActionEntry } from '@deepseek-ai/dsh-api-browser-controller/types'
import type { BrowserInjected } from './index.ts'
import css from './BrowserPanel.module.css'

export type BrowserPanelProps =
  & PropsRuntime<'browser'>
  & PropsLocale<'browser'>
  & InjectFace<BrowserInjected>

/** Screen-space cursor position over the viewport; fromUser distinguishes the agent vs the pointer. */
interface CursorState { x: number; y: number; fromUser: boolean }

/** Latest action that carries a click target, or undefined. */
function latestClick(actions: readonly BrowserActionEntry[]): BrowserActionEntry | undefined {
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const entry = actions[i]
    if (entry !== undefined && entry.clickX !== undefined && entry.clickY !== undefined) return entry
  }
  return undefined
}

/** Render one action log row. */
function ActionRow({ entry, t }: { entry: BrowserActionEntry; t: BrowserPanelProps['t'] }) {
  return (
    <li className={css.actionRow}>
      <span className={`${css.actionBadge} ${entry.ok ? css.ok : css.fail}`}>
        {entry.ok ? t('actionOk') : t('actionFail')}
      </span>
      <span className={css.actionName}>{entry.action}</span>
      {entry.args !== '' && <code className={css.actionArgs}>{entry.args}</code>}
      <a className={css.actionUrl} href={entry.url} target="_blank" rel="noreferrer">{entry.url}</a>
    </li>
  )
}

/** The browser panel occupant of the layout's 'browser' column. */
export function BrowserPanel({ t, useBrowser, start, navigate, stop }: BrowserPanelProps) {
  const { snapshot, error: streamError } = useBrowser(value => value)
  const [urlInput, setUrlInput] = useState('')
  const [cursor, setCursor] = useState<CursorState | null>(null)
  const [showActions, setShowActions] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const clickTarget = latestClick(snapshot.actions)
  const agentCursor = (() => {
    if (clickTarget?.clickX === undefined || clickTarget.clickY === undefined || viewportRef.current === null
      || snapshot.frameWidth === undefined || snapshot.frameWidth === 0) return null
    const rect = viewportRef.current.getBoundingClientRect()
    return {
      x: (clickTarget.clickX / snapshot.frameWidth) * rect.width,
      y: (clickTarget.clickY / (snapshot.frameHeight ?? 1)) * rect.height,
      fromUser: false,
    } satisfies CursorState
  })()
  const shownCursor = cursor ?? agentCursor

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top, fromUser: true })
  }

  const run = async (operation: () => Promise<void>) => {
    setPending(true)
    setError('')
    try {
      await operation()
      setUrlInput('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }
  const onStart = () => run(() => snapshot.open ? navigate(urlInput) : start(urlInput))

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !pending) void onStart()
  }

  return (
    <section className={css.panel} aria-label={t('panelTitle')}>
      <header className={css.header}>
        <span className={css.title}>{t('panelTitle')}</span>
        <span className={`${css.status} ${snapshot.open ? css.statusOpen : ''}`}>
          {snapshot.open ? t('statusOpen') : t('statusClosed')}
        </span>
        <span className={css.url} title={snapshot.url}>{snapshot.url}</span>
      </header>

      <div className={css.toolbar}>
        <input
          className={css.urlInput}
          value={urlInput}
          onChange={(e) => { setUrlInput(e.target.value) }}
          onKeyDown={onKeyDown}
          placeholder={t('openUrlPlaceholder')}
        />
        <button type="button" className={css.button} disabled={pending} onClick={() => void onStart()}>
          {snapshot.open ? t('navigate') : t('start')}
        </button>
        {snapshot.open && <button type="button" className={css.button} disabled={pending} onClick={() => void run(stop)}>{t('stop')}</button>}
      </div>
      {(error || streamError) !== '' && <div role="alert" className={css.error}>{error || streamError}</div>}

      {snapshot.open ? (
        <div
          ref={viewportRef}
          className={css.viewport}
          onPointerMove={onPointerMove}
          onPointerLeave={() => { setCursor(null) }}
        >
          {snapshot.frame ? (
            <img className={css.frame} src={snapshot.frame} alt={snapshot.title || snapshot.url} />
          ) : (
            <div className={css.placeholder}>{snapshot.title || snapshot.url || t('statusOpen')}</div>
          )}
          {shownCursor !== null && (
            <div
              className={css.cursor}
              data-user={shownCursor.fromUser || undefined}
              style={{ left: shownCursor.x, top: shownCursor.y }}
            />
          )}
        </div>
      ) : (
        <div className={css.closed}>
          <p>{t('closed')}</p>
        </div>
      )}

      <div className={css.actionsHeader}>
        <button type="button" className={css.linkButton} onClick={() => { setShowActions(v => !v) }}>
          {showActions ? t('hideActions') : t('showActions')}
        </button>
        <span className={css.actionCount}>{snapshot.actions.length}</span>
      </div>
      {showActions && (
        <ul className={css.actions}>
          {snapshot.actions.length === 0 && <li className={css.noActions}>{t('noActions')}</li>}
          {snapshot.actions.map(entry => <ActionRow key={entry.id} entry={entry} t={t} />)}
        </ul>
      )}
    </section>
  )
}
