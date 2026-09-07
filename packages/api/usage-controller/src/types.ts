/** Historical usage fields exposed to the settings dashboard. */
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Local Session persistence is not mounted. */
    'usage/unavailable': Record<string, never>
  }
}

/** Provider-reported tokens for one model on one UTC calendar date. */
export interface UsageDay {
  readonly date: string
  readonly provider: string
  readonly model: string
  readonly tokens: number
}

/** Local persisted usage; fork-inherited events never contribute twice. */
export interface UsageSummary {
  readonly days: readonly UsageDay[]
  readonly totalTokens: number
  readonly peakDailyTokens: number
  /** Largest per-session sum of completed turn durations, excluding idle gaps. */
  readonly longestSessionMs: number
  readonly sessions: number
  /** Settled attempts with absent or inconsistent provider-reported token usage. */
  readonly missingUsageAttempts: number
}
