/** Staged settings for the optional SearXNG search provider. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CardForm, textField, numberField, type CardActions, type CardFieldSpec, type CardFieldState, type CardShell } from './card-form.ts'

/** Host namespace, repeated here to keep the browser independent of Host imports. */
export const SEARXNG_NS = 'web-search-searxng'

/** Settings fields exposed by the SearXNG provider. */
export interface SearxngSettings {
  /** Whether SearXNG takes precedence over the DeepSeek provider. */
  enabled?: boolean
  /** Absolute HTTP(S) instance URL, optionally including a path prefix. */
  baseURL?: string
  /** Positive request timeout in milliseconds. */
  timeoutMs?: number
}

/** The SearXNG card's staged values and write status. */
export interface SearxngCardState extends CardShell {
  /** Staged provider enablement. */
  enabled: boolean
  /** Instance URL draft. */
  baseURL: CardFieldState
  /** Request timeout draft. */
  timeoutMs: CardFieldState
}

/** Business actions and snapshot injected into the SearXNG card. */
export interface SearxngCardFace extends CardActions {
  hooks: {
    /** Snapshot bound by the renderer as useSearxngCard. */
    searxngCard: SnapshotStore<SearxngCardState>
  }
}

const enabledField: CardFieldSpec = {
  field: 'enabled',
  format: value => String(value === true),
  parse: text => text === 'true' || text === 'false' ? { kind: 'set', value: text === 'true' } : undefined,
}
const instanceField: CardFieldSpec = {
  ...textField('baseURL'),
  parse: (text) => {
    const value = text.trim()
    if (value === '') return { kind: 'clear' }
    let url: URL
    try { url = new URL(value) } catch {
      // URL construction rejects malformed user input; the draft stays editable.
      return undefined
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return undefined
    // Normalize the parsed URL exactly as the Host validator does, so the
    // staged value matches what the Host stores and a save reports success.
    return { kind: 'set', value: `${url.origin}${url.pathname}` }
  },
}
const timeoutField: CardFieldSpec = {
  ...numberField('timeoutMs'),
  parse: (text) => {
    if (text.trim() === '') return { kind: 'clear' }
    const value = Number(text)
    return Number.isInteger(value) && value > 0 && value <= 2_147_483_647 ? { kind: 'set', value } : undefined
  },
}

/** Connect the SearXNG namespace to the shared save/discard form. */
export class SearxngCardController {
  private readonly form: CardForm<SearxngSettings>
  private readonly store: SnapshotStore<SearxngCardState>

  /** @param scope - the provider's bound settings namespace. */
  constructor(scope: SettingsScope<SearxngSettings>) {
    this.form = new CardForm(scope, [enabledField, instanceField, timeoutField])
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      enabled: this.form.field('enabled').text === 'true',
      baseURL: this.form.field('baseURL'),
      timeoutMs: this.form.field('timeoutMs'),
    }))
  }

  /**
   * Build the card's renderer injection.
   * @returns the staged snapshot and save, discard, edit, and reset actions.
   */
  inject(): SearxngCardFace {
    return { hooks: { searxngCard: this.store }, ...this.form.actions() }
  }
}
