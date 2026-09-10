/** Settled Tool-call wall time as a row's trailing duration label. @module */
import { rowDuration } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

/** The conversation dictionary share a Tool row's duration label fills. */
export type RowDurationTranslate = Translate<'row.durationSeconds' | 'row.durationMinutes'>

/**
 * Render one elapsed span through the row's duration templates.
 * @param ms - elapsed milliseconds.
 * @param t - translate seat supplying both duration templates.
 * @returns the localized duration label.
 */
export function rowDurationLabel(ms: number, t: RowDurationTranslate): string {
  const value = rowDuration(ms)
  return value.unit === 'seconds'
    ? t('row.durationSeconds', { seconds: value.seconds })
    : t('row.durationMinutes', { minutes: value.minutes, seconds: value.seconds })
}
