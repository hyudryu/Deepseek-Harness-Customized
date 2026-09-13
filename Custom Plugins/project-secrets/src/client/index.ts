/**
 * Project Secrets client plugin. Two registrations share one modal store: a
 * `sidebar.workspaces.actions` item that opens the modal for a workspace, and
 * a `sidebar.footer.action` row that hosts the modal itself.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createProjectSecretsStore } from './store.ts'
import { ProjectSecretsModalHost } from './ProjectSecretsModal.tsx'
import { en, zh } from './locales.ts'

const NS = 'projectSecrets'

export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'project-secrets: dictionaries')
  const store = createProjectSecretsStore()
  ctx.slots.inject('sidebar.workspaces.actions', () => ctx.slots.register({
    name: 'sidebar.workspaces.actions',
    id: 'project-secrets',
    order: 10,
    label: () => t('menuLabel'),
    locale: NS,
    inject: () => ({ onSelect: (workspaceId: string) => { store.openFor(workspaceId) } }),
  }, function ProjectSecretsMenuItem() {
    return null
  }))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'project-secrets-modal',
    order: 10,
    inject: () => ({ store, t }),
  }, ProjectSecretsModalHost))
}
