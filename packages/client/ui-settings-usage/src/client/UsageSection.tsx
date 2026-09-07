/** Read-only usage dashboard with local query and range state. */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { dailyTotals, dateAt, seriesFor, streaks } from './data.ts'
import type { UsageSummary } from './data.ts'
import css from './UsageSection.module.css'

/** Query callback supplied by the plugin's Remote service injection. */
export interface UsageInjected {
  /** Read saved-session usage from the Host. */
  loadUsage: () => Promise<UsageSummary>
}

/** Framework and callback shares for the usage settings section. */
export type UsageProps = PropsRuntime<'settings.section'> & PropsLocale<'usage'> & UsageInjected

/** Render saved usage, preserving the last result during an explicit refresh.
 * @param props - Framework locale and owner props plus the usage query.
 * @returns Accessible usage dashboard.
 */
export function UsageSection({ loadUsage, t }: UsageProps) {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const [range, setRange] = useState(7)
  const [mode, setMode] = useState<'daily' | 'weekly' | 'cumulative'>('daily')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(false)
    void loadUsage().then((value) => {
      if (active) { setSummary(value); setNow(Date.now()) }
    }).catch(() => { if (active) setError(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [loadUsage, revision])

  const number = (value: number) => new Intl.NumberFormat(t('language'), { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  const dateLabel = (date: string) => new Intl.DateTimeFormat(t('language'), { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(date))
  const totals = summary ? dailyTotals(summary) : new Map<string, number>()
  const streak = streaks(totals, now)
  const series = summary ? seriesFor(summary, now, range) : { dates: [], models: [] }
  const rangeTotal = series.models.reduce((sum, model) => sum + model.total, 0)
  const peak = Math.max(1, ...series.models.flatMap(model => model.values))
  const colors = ['var(--dsw-alias-link)', 'var(--dsw-alias-state-success-primary)', 'var(--dsw-alias-state-error-primary)', 'var(--dsw-alias-label-tertiary)']
  const identities = [...new Set(summary?.days.map(row => JSON.stringify([row.provider, row.model])) ?? [])].sort()
  const color = (key: string) => colors[identities.indexOf(key) % colors.length]
  const modelLabel = (model: { model: string; provider: string }) => `${model.model || t('unknownModel')} · ${model.provider || t('unknownProvider')}`
  const cellDates = Array.from({ length: 364 }, (_, index) => dateAt(now, index - 363))
  let running = 0
  const activity = cellDates.map((date, index) => {
    running += totals.get(date) ?? 0
    const value = mode === 'cumulative' ? running : mode === 'weekly'
      ? cellDates.slice(Math.floor(index / 7) * 7, Math.floor(index / 7) * 7 + 7).reduce((sum, day) => sum + (totals.get(day) ?? 0), 0)
      : totals.get(date) ?? 0
    return { date, value }
  })
  const activityPeak = Math.max(1, ...activity.map(cell => cell.value))
  let donutOffset = 0
  return <div className={css.dashboard} aria-busy={loading}>
    <header className={css.heading}><div><h2>{t('title')}</h2><p>{t('subtitle')}</p></div>
      <button type="button" className={css.button} disabled={loading} onClick={() =>{  setRevision(value => value + 1) }}>{t('refresh')}</button></header>
    {loading && <p role="status">{t('loading')}</p>}
    {error && <p role="alert">{t('error')}</p>}
    {summary && <>
      <dl className={css.metrics}>{[
        [t('total'), number(summary.totalTokens)], [t('peak'), number(summary.peakDailyTokens)],
        [t('longestSession'), `${Math.floor(summary.longestSessionMs / 3_600_000)} ${t('hours')} ${Math.floor(summary.longestSessionMs / 60_000) % 60} ${t('minutes')}`],
        [t('currentStreak'), `${streak.current} ${t('days')}`], [t('longestStreak'), `${streak.longest} ${t('days')}`],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {summary.totalTokens === 0 && <p role="status" className={css.empty}>{t('empty')}</p>}
      <section className={css.card} aria-label={t('activity')}>
        <div className={css.row}><h3>{t('activity')}</h3><div className={css.segment}>
          {(['daily', 'weekly', 'cumulative'] as const).map(value => <button type="button" key={value} aria-pressed={mode === value} onClick={() =>{  setMode(value) }}>{t(value)}</button>)}
        </div></div>
        <div className={css.heatScroll}><div className={css.heatmap}>{activity.map(cell => <span key={cell.date} className={css.cell} style={{ '--usage-intensity': cell.value === 0 ? 0 : 0.25 + 0.75 * cell.value / activityPeak } as CSSProperties} title={`${cell.date}: ${number(cell.value)} ${t('tokens')}`} />)}</div>
          <div className={css.months}>{Array.from({ length: 12 }, (_, index) => <span key={index}>{new Intl.DateTimeFormat(t('language'), { month: 'short', timeZone: 'UTC' }).format(new Date(dateAt(now, Math.round(index * 363 / 11) - 363)))}</span>)}</div></div>
        <div className={css.heatLegend}><span>{t('less')}</span>{[0, 0.25, 0.5, 0.75, 1].map(value => <span key={value} className={css.cell} style={{ '--usage-intensity': value } as CSSProperties} />)}<span>{t('more')}</span></div>
      </section>
      <div className={css.row}><h3>{t('range')}</h3><div className={css.segment}>{[7, 30].map(value => <button type="button" key={value} aria-pressed={range === value} onClick={() =>{  setRange(value) }}>{t(value === 7 ? 'seven' : 'thirty')}</button>)}</div></div>
      <section className={css.card} aria-label={t('trend')}><h3>{t('trend')}</h3>
        <div className={css.legend}>{series.models.map(model => <span key={model.key}><i style={{ '--usage-color': color(model.key) } as CSSProperties} />{modelLabel(model)}</span>)}</div>
        {rangeTotal === 0 ? <p className={css.empty}>{t('noRange')}</p> : <>
          <svg className={css.trend} viewBox="0 0 640 220" role="img" aria-label={t('trend')}>
            {[0, 0.5, 1].map(value => <g key={value}><line className={css.gridline} x1="45" x2="628" y1={190 - value * 175} y2={190 - value * 175} /><text className={css.axis} x="0" y={194 - value * 175}>{number(peak * value)}</text></g>)}
            {series.models.map(model => <polyline key={model.key} className={css.line} style={{ '--usage-color': color(model.key) } as CSSProperties} points={model.values.map((value, day) => `${45 + day * 583 / (range - 1)},${190 - value / peak * 175}`).join(' ')}><title>{modelLabel(model)}: {number(model.total)} {t('tokens')}</title></polyline>)}
            {series.dates.filter((_, index) => index === 0 || index === range - 1 || index === Math.floor(range / 2)).map(date => <text key={date} className={css.axis} textAnchor={date === series.dates[0] ? 'start' : date === series.dates[range - 1] ? 'end' : 'middle'} x={45 + series.dates.indexOf(date) * 583 / (range - 1)} y="215">{dateLabel(date)}</text>)}
          </svg>
          <details className={css.tableDetails}><summary>{t('daily')}</summary><table><thead><tr><th>{t('daily')}</th>{series.models.map(model => <th key={model.key}>{modelLabel(model)}</th>)}</tr></thead><tbody>{series.dates.map((date, index) => <tr key={date}><th>{date}</th>{series.models.map(model => <td key={model.key}>{number(model.values[index] ?? 0)}</td>)}</tr>)}</tbody></table></details>
        </>}
      </section>
      <section className={css.card} aria-label={t('models')}><h3>{t('models')}</h3><div className={css.breakdown}>
        <div className={css.donutWrap}><svg className={css.donut} viewBox="0 0 200 200" role="img" aria-label={t('models')}><circle className={css.track} cx="100" cy="100" r="76" />{series.models.map((model) => {
          const fraction = model.total / rangeTotal
          const offset = donutOffset
          donutOffset += fraction
          return <circle key={model.key} className={css.arc} cx="100" cy="100" r="76" pathLength="1" strokeDasharray={`${fraction} ${1 - fraction}`} strokeDashoffset={-offset} style={{ '--usage-color': color(model.key) } as CSSProperties}><title>{modelLabel(model)}: {number(model.total)} {t('tokens')}</title></circle>
        })}</svg><div className={css.donutLabel}><strong>{number(rangeTotal)}</strong><span>{t('tokens')}</span></div></div>
        <ul className={css.modelList}>{series.models.map(model => <li key={model.key}><i style={{ '--usage-color': color(model.key) } as CSSProperties} /><div><strong>{modelLabel(model)}</strong><span>{number(model.total)} {t('tokens')}</span></div><span>{new Intl.NumberFormat(t('language'), { style: 'percent', maximumFractionDigits: 1 }).format(model.total / rangeTotal)}</span></li>)}{rangeTotal === 0 && <li>{t('noRange')}</li>}</ul>
      </div></section>
      <p className={css.footnote}>{t('utc')}{summary.missingUsageAttempts > 0 && <> {t('missing')}</>}</p>
    </>}
  </div>
}
