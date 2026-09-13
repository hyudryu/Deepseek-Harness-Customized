/**
 * The Project Secrets modal and editor. The menu item's onSelect opens the
 * store for a workspace; this host subscribes and portal-mounts the editor
 * while a workspace is selected.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProjectSecretsStore } from './store.ts'
import type { ProjectSecretsKey } from './locales.ts'

type Translate = (key: ProjectSecretsKey) => string

/** The modal host: portals the editor for the open workspace, else nothing. */
export function ProjectSecretsModalHost({ store, t }: { store: ProjectSecretsStore; t: Translate }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return createPortal(
    state.open && state.workspaceId !== undefined
      ? <ProjectSecretsEditor workspaceId={state.workspaceId} onClose={store.close} t={t} />
      : null,
    document.body,
  )
}

/** The editor body: fetch the block, allow editing, then PUT it back. */
function ProjectSecretsEditor({ workspaceId, onClose, t }: {
  workspaceId: string
  onClose: () => void
  t: Translate
}) {
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setError(null)
    setSaving(false)
    fetch(`/project-secrets/${encodeURIComponent(workspaceId)}`)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${String(res.status)}`); return res.json() })
      .then(data => { if (!cancelled) { setText(data.text ?? ''); setLoaded(true) } })
      .catch(err => { if (!cancelled) { setError(String((err as Error)?.message ?? err)); setLoaded(true) } })
    return () => { cancelled = true }
  }, [workspaceId])

  const save = (): void => {
    setSaving(true)
    setError(null)
    fetch(`/project-secrets/${encodeURIComponent(workspaceId)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then(res => { if (!res.ok) throw new Error(`HTTP ${String(res.status)}`); onClose() })
      .catch(err => { setError(String((err as Error)?.message ?? err)); setSaving(false) })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('title')}
      closeLabel={t('close')}
    >
      {error !== null && (
        <div style={{ color: 'var(--dsw-color-error, #d00)', marginBottom: 8 }}>{error}</div>
      )}
      <textarea
        style={{ width: '100%', minHeight: 240, fontFamily: 'monospace', boxSizing: 'border-box' }}
        value={text}
        disabled={!loaded}
        placeholder={t('placeholder')}
        onChange={e => setText(e.currentTarget.value)}
      />
      <div style={{ marginTop: 12, textAlign: 'right' }}>
        <Button disabled={saving || !loaded} onClick={save}>{t('save')}</Button>
        <Button onClick={onClose}>{t('cancel')}</Button>
      </div>
    </Modal>
  )
}
