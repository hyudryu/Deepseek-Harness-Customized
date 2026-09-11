/** Settled Cordis Tool-call wall time as a row's trailing duration label. */
import { rowDuration } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'

/** The Cordis dictionary share a row's duration label fills. */
type CordisDurationTranslate = PropsLocale<'cordis'>['t']

/**
 * Elapsed wall time of a settled Cordis call, absent while it runs or when its
 * paired call head fell outside the loaded window.
 * @param block - frozen running call or settled result node.
 * @returns elapsed milliseconds, or null when the row carries no settled span.
 */
export function settledDurationMs(block: ToolCallViewProps['block']): number | null {
  return 'kind' in block && block.callTime !== null ? Math.max(0, block.time - block.callTime) : null
}

/**
 * Render one elapsed span through the row's duration templates.
 * @param ms - elapsed milliseconds.
 * @param t - translate seat supplying both duration templates.
 * @returns the localized duration label.
 */
export function durationLabel(ms: number, t: CordisDurationTranslate): string {
  const value = rowDuration(ms)
  return value.unit === 'seconds'
    ? t('row.durationSeconds', { seconds: value.seconds })
    : t('row.durationMinutes', { minutes: value.minutes, seconds: value.seconds })
}
