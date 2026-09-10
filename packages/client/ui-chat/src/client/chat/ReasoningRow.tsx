/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { useEffect, useState } from 'react'
import { DisclosureRow, IconThinkOutline14, rowDuration } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

/** Tick cadence of a running block's elapsed label; the label's own unit is the second. */
const RUNNING_TICK_MS = 1_000

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/**
 * Elapsed span of one thinking block: the recorded end once it closed, the wall
 * clock while it is still open. A live block re-renders on this row's own timer
 * rather than waiting for the next streamed delta, so a model that has gone
 * quiet still shows the time it is taking.
 * @param startedAt - first recorded instant of the block, absent when none was recorded.
 * @param endedAt - instant the block closed, absent while it is streaming.
 * @returns elapsed milliseconds, or null when no start was recorded.
 */
function useElapsedMs(startedAt: number | undefined, endedAt: number | undefined): number | null {
  const [now, setNow] = useState(() => Date.now())
  const open = startedAt !== undefined && endedAt === undefined
  useEffect(() => {
    if (!open) return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => { setNow(Date.now()) }, RUNNING_TICK_MS)
    return () => { window.clearInterval(timer) }
  }, [open, startedAt])
  if (startedAt === undefined) return null
  return Math.max(0, (endedAt ?? now) - startedAt)
}

/**
 * Render one assistant reasoning block as the Think disclosure row.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.startedAt - first recorded instant of this block, absent when none was recorded.
 * @param props.endedAt - instant this block closed, absent while it is still streaming.
 * @param props.t - conversation locale seat for the running status and the duration.
 * @returns the reasoning disclosure.
 */
export function ReasoningRow({ text, running, startedAt, endedAt, t }: {
  text: string
  running: boolean
  startedAt?: number | undefined
  endedAt?: number | undefined
  t: ChatViewSlotProps['t']
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = running ? latestLine(text) : firstLine(text)
  const elapsedMs = useElapsedMs(startedAt, endedAt)
  const duration = elapsedMs === null ? null : rowDuration(elapsedMs)

  return (
    <div
      className={css.root}
      data-variant="think"
      data-state={running ? 'running' : 'ok'}
      data-expanded={expanded || undefined}
    >
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title={t('message.think')}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary} data-follow-end={running || undefined}>
              <span className={css.summaryText}>{summary}</span>
            </span>
            {duration !== null && (
              <span className={css.duration}>
                {duration.unit === 'seconds'
                  ? t('duration.seconds', { seconds: duration.seconds })
                  : t('duration.minutes', { minutes: duration.minutes, seconds: duration.seconds })}
              </span>
            )}
          </>
        )}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
    </div>
  )
}
