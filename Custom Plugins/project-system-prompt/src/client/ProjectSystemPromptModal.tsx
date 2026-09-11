/**
 * The project system-prompt modal and editor. The menu item's onSelect opens
 * the store for a workspace; this host subscribes and portal-mounts the editor
 * while a workspace is selected.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProjectSystemPromptStore } from './store.ts'
import type { ProjectSystemPromptKey } from './locales.ts'

type Translate = (key: ProjectSystemPromptKey) => string

/** One editor load: the saved override, the deployment default, and its file path. */
interface PromptPayload {
  text?: string
  defaultText?: string
  path?: string
}

/** Parse one route response, rejecting a non-OK status with its server message. */
async function readPayload(response: Response): Promise<PromptPayload> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? `HTTP ${String(response.status)}`)
  }
  return await response.json() as PromptPayload
}

/** The modal host: portals the editor for the open workspace, else nothing. */
export function ProjectSystemPromptModalHost({ store, t }: {
  store: ProjectSystemPromptStore
  t: Translate
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return createPortal(
    state.open && state.workspaceId !== undefined
      ? <ProjectSystemPromptEditor workspaceId={state.workspaceId} onClose={store.close} t={t} />
      : null,
    document.body,
  )
}

/**
 * The editor body: fetch the saved override plus the DeepSeek default, allow
 * editing, then PUT it back. Restore copies the fetched default into the field
 * so it can be edited as a baseline instead of written from scratch.
 */
function ProjectSystemPromptEditor({ workspaceId, onClose, t }: {
  workspaceId: string
  onClose: () => void
  t: Translate
}) {
  const [text, setText] = useState('')
  const [defaultText, setDefaultText] = useState('')
  const [path, setPath] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setError(null)
    setSaving(false)
    fetch(`/project-system-prompt/${encodeURIComponent(workspaceId)}`)
      .then(readPayload)
      .then((data) => {
        if (cancelled) return
        setText(data.text ?? '')
        setDefaultText(data.defaultText ?? '')
        setPath(data.path ?? '')
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [workspaceId])

  const save = (): void => {
    setSaving(true)
    setError(null)
    fetch(`/project-system-prompt/${encodeURIComponent(workspaceId)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then(readPayload)
      .then(() => { onClose() })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setSaving(false)
      })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('title')}
      closeLabel={t('close')}
      description={path === '' ? undefined : path}
      footer={(
        <>
          <Button
            disabled={saving || !loaded || defaultText === ''}
            onClick={() => { setText(defaultText) }}
          >
            {t('restore')}
          </Button>
          <Button disabled={saving} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={saving || !loaded} onClick={save}>{t('save')}</Button>
        </>
      )}
    >
      {error !== null && (
        <div style={{ color: 'var(--dsw-color-error, #d00)', marginBottom: 8 }}>{error}</div>
      )}
      <textarea
        style={{
          width: '100%',
          minHeight: 320,
          fontFamily: 'monospace',
          fontSize: 12,
          boxSizing: 'border-box',
          resize: 'vertical',
        }}
        value={text}
        disabled={!loaded}
        aria-label={t('title')}
        placeholder={loaded ? t('placeholder') : t('loading')}
        onChange={e => setText(e.currentTarget.value)}
      />
      <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.7 }}>{t('hint')}</p>
    </Modal>
  )
}
