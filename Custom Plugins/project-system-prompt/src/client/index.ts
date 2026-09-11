/**
 * Project System Prompt client plugin. Two registrations share one modal store:
 * a `sidebar.workspaces.actions` item that opens the modal for a workspace, and
 * a `sidebar.footer.action` row that hosts the modal itself.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createProjectSystemPromptStore } from './store.ts'
import { ProjectSystemPromptModalHost } from './ProjectSystemPromptModal.tsx'
import { en, zh } from './locales.ts'

const NS = 'projectSystemPrompt'

export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'project-system-prompt: dictionaries')
  const store = createProjectSystemPromptStore()
  ctx.slots.inject('sidebar.workspaces.actions', () => ctx.slots.register({
    name: 'sidebar.workspaces.actions',
    id: 'project-system-prompt',
    order: 20,
    label: () => t('menuLabel'),
    locale: NS,
    inject: () => ({ onSelect: (workspaceId: string) => { store.openFor(workspaceId) } }),
  }, function ProjectSystemPromptMenuItem() {
    return null
  }))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'project-system-prompt-modal',
    order: 20,
    inject: () => ({ store, t }),
  }, ProjectSystemPromptModalHost))
}
