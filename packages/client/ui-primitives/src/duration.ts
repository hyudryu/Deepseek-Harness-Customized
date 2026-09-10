/**
 * Row-duration bucketing shared by the transcript's Tool-call and reasoning
 * rows. Bucketing is here so both rows name the same elapsed span the same
 * way; the units stay in each plugin's own dictionary, per locale-owned copy.
 *
 * @module @deepseek-ai/dsh-client-ui-primitives/duration
 */

/**
 * Row-duration bucket. Sub-minute spans report seconds with one decimal, so a
 * short call is not flattened to `0s`; a minute and over reports whole minutes
 * plus seconds zero-padded to two digits, so the label keeps a stable width.
 */
export type RowDuration =
  | { readonly unit: 'seconds'; readonly seconds: number }
  | { readonly unit: 'minutes'; readonly minutes: number; readonly seconds: string }

/**
 * Elapsed span as the parts a row's duration template fills.
 * @param ms - elapsed milliseconds; negatives clamp to zero.
 * @returns the bucket and its magnitudes.
 */
export function rowDuration(ms: number): RowDuration {
  const seconds = Math.max(0, ms) / 1_000
  const tenths = Math.round(seconds * 10) / 10
  if (tenths < 60) return { unit: 'seconds', seconds: tenths }
  // Rounding before the minute split keeps `59.96s` from printing as `60.0s`
  // and landing in the seconds bucket one tick before the minute template.
  const whole = Math.round(seconds)
  return {
    unit: 'minutes',
    minutes: Math.floor(whole / 60),
    seconds: String(whole % 60).padStart(2, '0'),
  }
}
