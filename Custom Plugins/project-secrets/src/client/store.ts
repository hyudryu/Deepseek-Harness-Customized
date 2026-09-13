/**
 * Shared project-secrets modal state: which workspace the editor is open for.
 * The menu item's onSelect calls openFor; the modal host subscribes and
 * portals the editor only while a workspace is selected.
 */
export interface ProjectSecretsState {
  /** The workspace whose secrets block the modal is editing. */
  workspaceId: string | undefined
  /** Whether the modal is showing. */
  open: boolean
}

export interface ProjectSecretsStore {
  getSnapshot(): ProjectSecretsState
  subscribe(listener: () => void): () => void
  openFor(workspaceId: string): void
  close(): void
}

/** Create the project-secrets modal store (no module-level singleton). */
export function createProjectSecretsStore(): ProjectSecretsStore {
  let state: ProjectSecretsState = { workspaceId: undefined, open: false }
  const listeners = new Set<() => void>()
  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    openFor: (workspaceId) => {
      state = { workspaceId, open: true }
      emit()
    },
    close: () => {
      state = { workspaceId: undefined, open: false }
      emit()
    },
  }
}
