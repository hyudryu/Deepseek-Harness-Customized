/**
 * Agent-scoped model selection shared by runtime entry points.
 * @module @deepseek-ai/dsh-agent/model-selection
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

/** Complete provider, model, and optional reasoning effort selected for one live Agent. */
export interface ModelSelection {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: ReasoningEffortId
}

/** Mutable model selection plus the value captured for the current step. */
export interface ModelSelectionRef {
  /** Model selected for the next step that enters prompt assembly. */
  current: ModelSelection | undefined
  /** Selection captured when the current step entered prompt assembly. */
  assembled: ModelSelection | undefined
}

/**
 * Live selections keyed by the Agent scope that consumes them. A weak key
 * makes disposal automatic, and the guarded removal below keeps a superseded
 * install from erasing the ref that replaced it.
 */
const installed = new WeakMap<Context, ModelSelectionRef>()

/**
 * Read the route the next model request from one Agent scope will use. The
 * `assembled` snapshot wins because prompt assembly has already captured it for
 * the step in flight; `current` covers a scope that has not assembled yet. A
 * consumer that must size work for the upcoming request — automatic compaction
 * sizing its pressure threshold, for instance — reads this instead of the
 * latest durable request header, which still names the previous route until the
 * first request under a newly selected model is logged.
 *
 * @param agentCtx - The Agent's own scoped context.
 * @returns A detached selection snapshot, or `undefined` when no entry point installed one.
 */
export function selectedRouteFor(agentCtx: Context): ModelSelection | undefined {
  const selection = installed.get(agentCtx)
  if (selection === undefined) return undefined
  const selected = selection.assembled ?? selection.current
  return selected === undefined ? undefined : { ...selected }
}

/**
 * Couple one mutable selection to Agent-scoped prompt assembly and request routing.
 * Prompt assembly snapshots the selected model before delegating, then applies
 * its provider/model pair and effort to request config so a
 * concurrent switch takes effect on a later step instead of splitting the two
 * surfaces. An absent selected effort clears any inherited effort, restoring
 * the selected model's provider/default behavior.
 *
 * @param agentCtx - The selected Agent's scoped context.
 * @param selection - Mutable selection owned by the calling entry point.
 * @returns Disposer for both scoped waterfall listeners, which also retires this
 *   selection from {@link selectedRouteFor} unless a later install replaced it.
 */
export function installModelSelection(agentCtx: Context, selection: ModelSelectionRef): () => void {
  installed.set(agentCtx, selection)
  const disposeAssembly = agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const selected = selection.current
    const assembled = await next()
    selection.assembled = selected
    if (selected === undefined) return assembled
    return {
      ...assembled,
      variables: {
        ...assembled.variables,
        provider: selected.provider,
        model: selected.model,
      },
    }
  })
  const disposeRequest = agentCtx.on(
    'agent/request',
    async (_payload, next): Promise<LlmCallConfig> => {
      const resolved = await next()
      const selected = selection.assembled
      if (selected === undefined) return resolved
      const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
      return {
        ...withoutInheritedEffort,
        provider: selected.provider,
        model: selected.model,
        ...selected.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: selected.reasoningEffort },
      }
    },
  )
  return () => {
    disposeAssembly()
    disposeRequest()
    if (installed.get(agentCtx) === selection) installed.delete(agentCtx)
  }
}
