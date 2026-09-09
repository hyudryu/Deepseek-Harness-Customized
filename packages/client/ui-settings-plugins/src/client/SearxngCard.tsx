/** Optional SearXNG provider controls in the plugin configuration popup. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { SearxngCardFace } from './searxng-card-controller.ts'
import css from './fields.module.css'
import type {} from './slot-contract.ts'

/** Renderer-bound SearXNG settings card props. */
export type SearxngCardProps = PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'> & InjectFace<SearxngCardFace>

/**
 * Render staged enablement, instance URL, and request timeout controls.
 * @param props - locale copy, provider snapshot, and form actions.
 * @returns the provider card when its namespace is available.
 */
export function SearxngCard(props: SearxngCardProps) {
  const { t } = props
  const state = props.useSearxngCard(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  return (
    <PluginCard t={t} titleKey="searxngTitle" descriptionKey="searxngDescription"
      state={state} onSave={props.save} onDiscard={props.discard}>
      <div className={css.field}>
        <label className={css.head}>
          <input type="checkbox" role="switch" checked={state.enabled} disabled={disabled}
            onChange={(event) => { props.edit('enabled', String(event.target.checked)) }} />
          <span className={css.label}>{t('searxngEnabled')}</span>
        </label>
        <p className={css.hint}>{t('searxngEnabledHint')}</p>
      </div>
      <ValueField id="plugin-config-searxng-url" label={t('searxngBaseURL')}
        hint={t('searxngBaseURLHint')} overriddenLabel={t('overridden')} resetLabel={t('reset')}
        invalidLabel={t('searxngInvalidURL')} disabled={disabled} {...state.baseURL}
        onEdit={(text) => { props.edit('baseURL', text) }} onReset={() => { props.resetField('baseURL') }} />
      <ValueField id="plugin-config-searxng-timeout" label={t('searxngTimeout')}
        hint={t('searxngTimeoutHint')} overriddenLabel={t('overridden')} resetLabel={t('reset')}
        invalidLabel={t('searxngInvalidTimeout')} numeric disabled={disabled} {...state.timeoutMs}
        onEdit={(text) => { props.edit('timeoutMs', text) }} onReset={() => { props.resetField('timeoutMs') }} />
    </PluginCard>
  )
}
