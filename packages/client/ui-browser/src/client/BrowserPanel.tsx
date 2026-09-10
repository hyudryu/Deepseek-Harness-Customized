/**
 * Live per-session browser panel: the streamed page frame, the browser
 * action log, and a glowing cursor that shows the agent's click point and
 * follows the user's pointer over the viewport. Pointer, wheel, and keyboard
 * input over the frame is forwarded to the page, so the panel is the session's
 * interactive browser rather than a screenshot view. All data arrives through
 * the injected session verbs; the component holds only transient viewing state.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserActionEntry, BrowserInputEvent, BrowserMouseButton } from '@deepseek-ai/dsh-api-browser-controller/types'
import type { BrowserInjected } from './index.ts'
import css from './BrowserPanel.module.css'

export type BrowserPanelProps =
  & PropsRuntime<'browser'>
  & PropsLocale<'browser'>
  & InjectFace<BrowserInjected>

/** Screen-space cursor position over the viewport; fromUser distinguishes the agent vs the pointer. */
interface CursorState { x: number; y: number; fromUser: boolean }

/** Where the contained frame sits inside the panel viewport, in panel pixels and page pixels. */
interface FrameMapping { scale: number; offsetX: number; offsetY: number; width: number; height: number }

/** Keys forwarded as named presses rather than inserted text; space is handled separately. */
const NAMED_KEYS = new Set([
  'Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'Insert',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
])

/** Minimum gap between forwarded pointer-move events, in ms. */
const MOVE_INTERVAL_MS = 50

/** Latest action that carries a click target, or undefined. */
function latestClick(actions: readonly BrowserActionEntry[]): BrowserActionEntry | undefined {
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const entry = actions[i]
    if (entry !== undefined && entry.clickX !== undefined && entry.clickY !== undefined) return entry
  }
  return undefined
}

/** The key fields a panel keyboard event carries. */
interface KeyEventLike { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean }

/** Playwright modifier prefix for a keyboard event that carries modifiers. */
function modifierPrefix(event: KeyEventLike): string {
  return `${event.ctrlKey ? 'Control+' : ''}${event.altKey ? 'Alt+' : ''}${event.metaKey ? 'Meta+' : ''}${event.shiftKey ? 'Shift+' : ''}`
}

/**
 * Translate one panel keydown into the page input it represents.
 * @param event - the key fields of the panel's keyboard event.
 * @returns the input event to forward, or undefined for keys the panel ignores (dead keys, shortcuts owned by the desktop).
 */
function keyInput(event: KeyEventLike): BrowserInputEvent | undefined {
  const prefix = modifierPrefix(event)
  if (event.key === ' ') return { kind: 'key', key: `${prefix}Space` }
  if (event.key.length === 1) {
    if (!event.ctrlKey && !event.altKey && !event.metaKey) return { kind: 'text', text: event.key }
    return { kind: 'key', key: `${prefix}${/[a-z]/.test(event.key) ? event.key.toUpperCase() : event.key}` }
  }
  if (NAMED_KEYS.has(event.key)) return { kind: 'key', key: `${prefix}${event.key}` }
  return undefined
}

/** Map a panel-space point onto page CSS pixels; undefined outside the contained frame. */
function toPagePoint(mapping: FrameMapping, element: HTMLElement, clientX: number, clientY: number): { x: number; y: number } | undefined {
  if (mapping.scale <= 0) return undefined
  const rect = element.getBoundingClientRect()
  const x = (clientX - rect.left - mapping.offsetX) / mapping.scale
  const y = (clientY - rect.top - mapping.offsetY) / mapping.scale
  if (x < 0 || y < 0 || x >= mapping.width || y >= mapping.height) return undefined
  return { x, y }
}

/** Consecutive click count of a pointer event, bounded to the page's triple-click range. */
function clickCount(detail: number): number {
  return Math.min(Math.max(detail || 1, 1), 3)
}

/** Mouse button of a DOM pointer event. */
function pointerButton(button: number): BrowserMouseButton {
  if (button === 1) return 'middle'
  if (button === 2) return 'right'
  return 'left'
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
export function BrowserPanel({
  t, useBrowser, start, navigate, stop, createTab, selectTab, closeTab, openPanel, sendInput,
}: BrowserPanelProps) {
  const { snapshot, error: streamError } = useBrowser(value => value)
  const [urlInput, setUrlInput] = useState<string | null>(null)
  const [cursor, setCursor] = useState<CursorState | null>(null)
  const [showActions, setShowActions] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = viewportRef.current
    if (element === null) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      setViewport({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [snapshot.open])

  const clickTarget = latestClick(snapshot.actions)
  const frameWidth = snapshot.frameWidth ?? 0
  const frameHeight = snapshot.frameHeight ?? 0
  const scale = frameWidth > 0 && frameHeight > 0
    ? Math.min(viewport.width / frameWidth, viewport.height / frameHeight) : 0
  const mapping: FrameMapping = {
    scale,
    offsetX: (viewport.width - frameWidth * scale) / 2,
    offsetY: (viewport.height - frameHeight * scale) / 2,
    width: frameWidth,
    height: frameHeight,
  }
  const mappingRef = useRef(mapping)
  mappingRef.current = mapping
  const agentCursor = clickTarget?.clickX !== undefined && clickTarget.clickY !== undefined && scale > 0
    ? {
      x: (viewport.width - frameWidth * scale) / 2 + clickTarget.clickX * scale,
      y: (viewport.height - frameHeight * scale) / 2 + clickTarget.clickY * scale,
      fromUser: false,
    } satisfies CursorState : null
  const shownCursor = cursor ?? agentCursor

  const emitInput = (event: BrowserInputEvent) => {
    void sendInput(event).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }
  const emitRef = useRef(emitInput)
  emitRef.current = emitInput
  const lastMove = useRef(0)

  // The browser may open without a panel gesture (the agent's `browser` tool), so
  // an opening snapshot reveals the column; hiding the panel while the browser
  // stays open is never undone, because only the opening transition reveals.
  const revealed = useRef(false)
  useEffect(() => {
    if (snapshot.open && !revealed.current) openPanel()
    revealed.current = snapshot.open
  }, [openPanel, snapshot.open])

  // Wheel is claimed for the page: React registers wheel passively at the root,
  // so the panel needs its own non-passive listener to stop the app scrolling.
  useLayoutEffect(() => {
    const element = viewportRef.current
    if (element === null || !snapshot.open) return
    const onWheel = (native: WheelEvent) => {
      const point = toPagePoint(mappingRef.current, element, native.clientX, native.clientY)
      if (point === undefined) return
      native.preventDefault()
      emitRef.current({ kind: 'wheel', ...point, deltaX: native.deltaX, deltaY: native.deltaY })
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => { element.removeEventListener('wheel', onWheel) }
  }, [snapshot.open])

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top, fromUser: true })
    const point = toPagePoint(mappingRef.current, e.currentTarget, e.clientX, e.clientY)
    if (point === undefined) return
    const now = Date.now()
    if (now - lastMove.current < MOVE_INTERVAL_MS) return
    lastMove.current = now
    emitInput({ kind: 'move', ...point })
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
    const point = toPagePoint(mappingRef.current, e.currentTarget, e.clientX, e.clientY)
    if (point === undefined) return
    e.currentTarget.focus()
    if (typeof e.currentTarget.setPointerCapture === 'function') e.currentTarget.setPointerCapture(e.pointerId)
    emitInput({ kind: 'down', ...point, button: pointerButton(e.button), clickCount: clickCount(e.detail) })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
    const point = toPagePoint(mappingRef.current, e.currentTarget, e.clientX, e.clientY)
    if (point === undefined) return
    if (typeof e.currentTarget.releasePointerCapture === 'function') e.currentTarget.releasePointerCapture(e.pointerId)
    emitInput({ kind: 'up', ...point, button: pointerButton(e.button), clickCount: clickCount(e.detail) })
  }

  const onViewportKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const input = keyInput(e)
    if (input === undefined) return
    e.preventDefault()
    emitInput(input)
  }

  const run = async (operation: () => Promise<void>) => {
    setPending(true)
    setError('')
    try {
      await operation()
      setUrlInput(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }
  const onStart = () => run(() => snapshot.open ? navigate(urlInput ?? snapshot.url) : start(urlInput ?? undefined))

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

      {snapshot.open && <div className={css.tabBar}>
        <div className={css.tabs} role="tablist" aria-label={t('tabs')}>
          {snapshot.tabs?.map((tab, index, tabs) => {
            const label = tab.title || tab.url || t('untitledTab')
            return <div key={tab.id} className={css.tabItem}>
              <button type="button" role="tab" className={css.tab}
                aria-selected={tab.id === snapshot.activeTabId} title={tab.url} disabled={pending}
                tabIndex={tab.id === snapshot.activeTabId ? 0 : -1}
                onClick={() => void run(() => selectTab(tab.id))}
                onKeyDown={(event) => {
                  const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
                  if (delta === 0 || pending) return
                  event.preventDefault()
                  const next = (index + delta + tabs.length) % tabs.length
                  const target = tabs[next]
                  const button = event.currentTarget.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]')[next]
                  if (button instanceof HTMLButtonElement) button.focus()
                  if (target !== undefined) void run(() => selectTab(target.id))
                }}>{label}</button>
              <button type="button" className={css.iconButton} disabled={pending}
                aria-label={`${t('closeTab')} ${label}`} onClick={() => void run(() => closeTab(tab.id))}>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            </div>
          })}
        </div>
        <button type="button" className={css.button} disabled={pending}
          onClick={() => void run(() => createTab())}>{t('newTab')}</button>
      </div>}

      <div className={css.toolbar}>
        <input
          className={css.urlInput}
          value={urlInput ?? snapshot.url}
          aria-label={t('address')}
          onChange={(e) => { setUrlInput(e.target.value) }}
          onKeyDown={onKeyDown}
          placeholder={t('openUrlPlaceholder')}
        />
        <button type="button" className={css.button} disabled={pending} onClick={() => void onStart()}>
          {snapshot.open ? t('navigate') : t('start')}
        </button>
        {snapshot.open && <button type="button" className={css.button} disabled={pending} onClick={() => void run(stop)}>{t('stop')}</button>}
      </div>
      {snapshot.open && <p className={css.interactionHelp}>{t('interactionHint')}</p>}
      {(error !== '' || streamError !== '') && <div role="alert" className={css.error}>{error || streamError}</div>}

      {snapshot.open ? (
        <div
          ref={viewportRef}
          className={css.viewport}
          tabIndex={0}
          aria-label={t('viewport')}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerLeave={() => { setCursor(null) }}
          onKeyDown={onViewportKeyDown}
          onContextMenu={(e) => { e.preventDefault() }}
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
