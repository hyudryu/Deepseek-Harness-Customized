/**
 * Shared project-system-prompt modal state: which workspace the editor is open
 * for. The menu item's onSelect calls openFor; the modal host subscribes and
 * portals the editor only while a workspace is selected.
 */
export interface ProjectSystemPromptState {
  /** The workspace whose system prompt override the modal is editing. */
  workspaceId: string | undefined
  /** Whether the modal is showing. */
  open: boolean
}

export interface ProjectSystemPromptStore {
  getSnapshot(): ProjectSystemPromptState
  subscribe(listener: () => void): () => void
  openFor(workspaceId: string): void
  close(): void
}

/** Create the project-system-prompt modal store (no module-level singleton). */
export function createProjectSystemPromptStore(): ProjectSystemPromptStore {
  let state: ProjectSystemPromptState = { workspaceId: undefined, open: false }
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
