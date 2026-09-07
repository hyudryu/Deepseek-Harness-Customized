/** Pure usage accounting over a session's own durable events. */
import { expandAssistantStream, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { UsageDay } from './types.ts'

/** One session's usage and active duration. */
export interface SessionUsage {
  readonly days: readonly UsageDay[]
  readonly activeMs: number
  readonly missingUsageAttempts: number
}

/**
 * Count settlement samples once per attempt, retaining failed retry usage.
 * @param events - Session events after its inherited prefix.
 * @returns Daily model buckets and completed-turn duration.
 */
export function aggregateSessionUsage(events: readonly SessionEvent[]): SessionUsage {
  const days = new Map<string, UsageDay>()
  let activeMs = 0
  let turnStart: { turn: number; time: number } | undefined
  let route = { provider: '', model: '' }
  let pending: { turn: number; step: number; time: number; provider: string; model: string; usage: TokenUsage | undefined } | undefined
  let missingUsageAttempts = 0
  const settle = (): void => {
    if (pending === undefined) return
    const { usage, time, provider, model } = pending
    if (usage === undefined) missingUsageAttempts++
    else {
      const date = new Date(time).toISOString().slice(0, 10)
      const key = JSON.stringify([date, provider, model])
      const tokens = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
      days.set(key, { date, provider, model, tokens: (days.get(key)?.tokens ?? 0) + tokens })
    }
    pending = undefined
  }
  for (const event of events) {
    if (event.type === 'turn/start') turnStart = { turn: event.data.turn, time: event.time }
    if (event.type === 'turn/end' && turnStart?.turn === event.data.turn) {
      if (event.data.reason.kind !== 'interrupted') activeMs += Math.max(0, event.time - turnStart.time)
      turnStart = undefined
    }
    if (event.type === 'request/context') route = { provider: event.data.provider, model: event.data.model }
    if (event.type === 'llm/retry-started' || event.type === 'step/start') settle()
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue
    if (pending !== undefined && (pending.turn !== event.data.turn || pending.step !== event.data.step)) settle()
    let usage = event.type === 'assistant/message' ? event.data.usage : undefined
    if (usage === undefined) {
      for (const member of expandAssistantStream(event.data.stream)) {
        if (member.chunk.type === 'usage') usage = member.chunk.usage
      }
    }
    usage ??= pending?.usage
    const source = event.type === 'assistant/message' ? event.data.message.source : route
    pending = { turn: event.data.turn, step: event.data.step, time: event.time, provider: source.provider, model: source.model, usage }
  }
  settle()
  return { days: [...days.values()], activeMs, missingUsageAttempts }
}
