/** Pure usage accounting over a session's own durable events. */
import { expandAssistantStream, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { UsageDay } from './types.ts'

/** One session's usage and active duration. */
export interface SessionUsage {
  readonly days: readonly UsageDay[]
  readonly activeMs: number
  readonly missingUsageAttempts: number
}

/**
 * Count each durable settlement, retaining failed retry usage and inherited routing.
 * @param events - Complete Session events, including the inherited prefix.
 * @param inheritedEventCount - Prefix length used only to recover request routing.
 * @returns Daily model buckets and completed-turn duration.
 */
export function aggregateSessionUsage(events: readonly SessionEvent[], inheritedEventCount = 0): SessionUsage {
  const days = new Map<string, UsageDay>()
  let activeMs = 0
  let turnStart: { turn: number; time: number } | undefined
  let route = { provider: '', model: '' }
  let missingUsageAttempts = 0
  for (const [index, event] of events.entries()) {
    if (event.type === 'request/context') route = { provider: event.data.provider, model: event.data.model }
    if (index < inheritedEventCount) continue
    if (event.type === 'turn/start') turnStart = { turn: event.data.turn, time: event.time }
    if (event.type === 'turn/end' && turnStart?.turn === event.data.turn) {
      if (event.data.reason.kind !== 'interrupted') activeMs += Math.max(0, event.time - turnStart.time)
      turnStart = undefined
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue
    let usage: TokenUsage | undefined = event.type === 'assistant/message' ? event.data.usage : undefined
    if (usage === undefined) {
      for (const member of expandAssistantStream(event.data.stream)) {
        if (member.chunk.type === 'usage') usage = member.chunk.usage
      }
    }
    if (usage === undefined) {
      missingUsageAttempts++
      continue
    }
    const { provider, model } = event.type === 'assistant/message' ? event.data.message.source : route
    const date = new Date(event.time).toISOString().slice(0, 10)
    const key = JSON.stringify([date, provider, model])
    const tokens = usage.totalTokens
      ?? (usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0))
    days.set(key, { date, provider, model, tokens: (days.get(key)?.tokens ?? 0) + tokens })
  }
  return { days: [...days.values()], activeMs, missingUsageAttempts }
}
