// index.js — Cordis wiring for the Qwen tool-call adapter.
//
// The adapter registers an `llm/stream` waterfall listener. For a request that
// matches the configured provider/model (or any request when the plugin is
// configured with no targets, which is the default), it wraps the underlying
// stream with `translateQwenChunks`: Qwen-family models that emit tool calls as
// text markup get those calls re-emitted as structured `tool-call` blocks so
// the agent loop dispatches them instead of treating the reply as plain text
// and stopping.
//
// The translation is a per-request pass-through that never rewrites the frozen
// request (`options`); it only transforms outgoing stream chunks, so the
// session log still records the assembled assistant message (the
// model-visible ⟺ logged invariant is preserved because the transformed
// chunks are what the loop assembles and logs).
//
// This module keeps the only @deepseek-ai dependency out, so the plugin loads
// with no workspace packages installed. See core.js for the dependency-free
// translation logic and its `node --test` suite.

import { translateQwenChunks } from './core.js'

/** Stable Cordis plugin name. */
export const name = 'qwen-tool-adapter'

/** Services required before the stream waterfall can be registered. */
export const inject = ['llm']

/** Normalize and validate the plugin config. */
function normalizeConfig(raw = {}) {
  const enabled = raw.enabled ?? true
  if (typeof enabled !== 'boolean') throw new Error('qwen-tool-adapter: enabled must be a boolean')
  const providers = raw.providers ?? []
  const models = raw.models ?? []
  if (!Array.isArray(providers) || !providers.every(entry => typeof entry === 'string')) {
    throw new Error('qwen-tool-adapter: providers must be an array of provider route strings')
  }
  if (!Array.isArray(models) || !models.every(entry => typeof entry === 'string')) {
    throw new Error('qwen-tool-adapter: models must be an array of model id strings')
  }
  return { enabled, providers, models }
}

/** Whether one request's provider/model falls within the configured targets. */
function matchesRequest(config, provider, model) {
  const providerMatch = config.providers.length === 0 || config.providers.includes(provider)
  const modelMatch = config.models.length === 0 || config.models.includes(model)
  return providerMatch && modelMatch
}

export function apply(ctx, rawConfig = {}) {
  const config = normalizeConfig(rawConfig)

  ctx.effect(() =>
    ctx.on('llm/stream', (options, next) => {
      if (!config.enabled) return next()
      if (!matchesRequest(config, options.provider, options.model)) return next()
      // A loop-built request is deep-frozen; we never touch it, only wrap the
      // underlying chunk stream it resolves to.
      const upstream = next()
      return translateQwenChunks(upstream)
    }, { global: true }),
  )
}

/** Test-only surface for the standalone plugin suite. */
export const __test = { normalizeConfig, matchesRequest }
