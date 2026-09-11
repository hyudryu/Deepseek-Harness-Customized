/**
 * Provider-owned request-retry policy configuration and resolution.
 *
 * Adapters expose one resolved policy per registered provider route; the
 * optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
 *
 * @module @deepseek-ai/dsh-llm/retry-policy
 */

import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { EMPTY_RESPONSE_CODE } from './error.ts'

/**
 * Shipped wait before retry 1, 2, and 3. A provider route that configures
 * neither `retryDelaysMs` nor `backoff` inherits this schedule, so an
 * exhausted transient failure surfaces after roughly six minutes of recovery
 * instead of the sub-second exponential ramp that gives up before a rate
 * limit or a rolling provider outage clears.
 */
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = Object.freeze([5_000, 60_000, 300_000])
const DEFAULT_MAX_RETRIES = DEFAULT_RETRY_DELAYS_MS.length
const DEFAULT_INITIAL_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 10_000
const DEFAULT_JITTER_RATIO = 0.1
const DEFAULT_RETRYABLE_CODES = Object.freeze([
  EMPTY_RESPONSE_CODE,
  'RATE_LIMIT',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
])

/** Bounded exponential backoff with symmetric jitter around each local delay. */
export interface BackoffConfig {
  /** Initial local exponential-backoff delay in milliseconds (default 500). */
  initialDelayMs?: number
  /** Maximum locally scheduled or accepted provider delay in milliseconds (default 10000). */
  maxDelayMs?: number
  /** Symmetric random multiplier range around one (default 0.1). */
  jitterRatio?: number
}

/** Current bounded transient retry behavior for one provider route. */
export interface NormalRetryPolicyConfig {
  /** Retry only configured transient failure codes. */
  mode: 'normal'
  /** Maximum eligible retries after the first request (default: the configured schedule length). */
  maxRetries?: number
  /** Stable failure codes eligible for this policy. */
  retryableCodes?: string[]
  /**
   * Explicit wait before each retry, in milliseconds: entry `n` is the delay
   * before retry `n + 1`. Mutually exclusive with `backoff`; omission inherits
   * the default five-second, one-minute, five-minute schedule. An empty list
   * also selects that default, because the configuration schema materializes an
   * omitted array as empty; use `maxRetries: 0` to disable retries instead.
   */
  retryDelaysMs?: number[]
  /** Local exponential-backoff and jitter configuration, used only when `retryDelaysMs` is absent. */
  backoff?: BackoffConfig
}

/** Unbounded retry behavior for every model-request failure on one provider route. */
export interface AlwaysRetryPolicyConfig {
  /** Retry every model-request failure until success, cancellation, or disposal. */
  mode: 'always'
  /** Local exponential-backoff and jitter configuration. */
  backoff?: BackoffConfig
}

/** Provider-owned model-request retry policy configuration. */
export type RetryPolicyConfig = NormalRetryPolicyConfig | AlwaysRetryPolicyConfig

/** Fully resolved backoff shared by both retry modes. */
export interface ResolvedRetryBackoff {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly jitterRatio: number
}

/** Fully resolved bounded transient retry policy. */
export interface ResolvedNormalRetryPolicy extends ResolvedRetryBackoff {
  readonly mode: 'normal'
  readonly maxRetries: number
  readonly retryableCodes: readonly string[]
  /** Scheduled wait before each retry, or `undefined` when this policy uses `backoff`. */
  readonly retryDelaysMs: readonly number[] | undefined
}

/** Fully resolved unbounded retry policy. */
export interface ResolvedAlwaysRetryPolicy extends ResolvedRetryBackoff {
  readonly mode: 'always'
}

/** Immutable provider policy captured when its adapter route is registered. */
export type ResolvedRetryPolicy = ResolvedNormalRetryPolicy | ResolvedAlwaysRetryPolicy

const backoffSchema: z<BackoffConfig> = z.object({
  initialDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
  maxDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
  jitterRatio: z.number().min(0).max(1).default(DEFAULT_JITTER_RATIO),
})

// `maxRetries` carries no schema default: resolution defaults it to the active
// schedule length, which a schema-level default would silently contradict for a
// route that configures a shorter `retryDelaysMs`.
const normalPolicySchema: z<NormalRetryPolicyConfig> = z.object({
  mode: z.const('normal').required(),
  maxRetries: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER),
  retryableCodes: z.array(z.string()).default([...DEFAULT_RETRYABLE_CODES]),
  retryDelaysMs: z.array(z.number()),
  backoff: backoffSchema,
})

const alwaysPolicySchema: z<AlwaysRetryPolicyConfig> = z.object({
  mode: z.const('always').required(),
  backoff: backoffSchema,
})

/** Cordis schema embedded by each concrete provider configuration. */
export const RetryPolicySchema: z<RetryPolicyConfig> = z.union([
  normalPolicySchema,
  alwaysPolicySchema,
])

const NORMAL_POLICY_KEYS: ReadonlySet<string> = new Set([
  'mode', 'maxRetries', 'retryableCodes', 'retryDelaysMs', 'backoff',
])
// Layered configuration can retain normal-only fields after switching modes;
// always mode ignores those inactive values while still rejecting unknown keys.
const ALWAYS_POLICY_KEYS: ReadonlySet<string> = new Set([
  'mode', 'maxRetries', 'retryableCodes', 'retryDelaysMs', 'backoff',
])
const BACKOFF_KEYS: ReadonlySet<string> = new Set(['initialDelayMs', 'maxDelayMs', 'jitterRatio'])

function validateKeys(value: object, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path}: unknown key "${key}"`)
  }
}

function resolveBackoff(
  config: BackoffConfig | undefined,
  path: string,
  defaultMaxDelayMs: number,
): ResolvedRetryBackoff {
  if (config !== undefined) validateKeys(config, BACKOFF_KEYS, path)
  const initialDelayMs = config?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  const maxDelayMs = config?.maxDelayMs ?? defaultMaxDelayMs
  const jitterRatio = config?.jitterRatio ?? DEFAULT_JITTER_RATIO

  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`)
  }
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error(`${path}.jitterRatio must be between 0 and 1`)
  }

  return Object.freeze({ initialDelayMs, maxDelayMs, jitterRatio })
}

/**
 * Validate one explicit per-retry wait schedule.
 * @param delaysMs - configured waits, or `undefined` to inherit the shipped schedule.
 * @param path - diagnostic path naming the provider config that owns the value.
 * @returns the detached, frozen schedule.
 */
function resolveRetryDelays(delaysMs: number[] | undefined, path: string): readonly number[] {
  const delays = delaysMs ?? DEFAULT_RETRY_DELAYS_MS
  if (delays.some(delay => !Number.isSafeInteger(delay) || delay <= 0 || delay > MAX_TIMER_DELAY_MS)) {
    throw new Error(
      `${path}.retryDelaysMs must contain only positive safe integers no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  return Object.freeze([...delays])
}

/**
 * Validate, default, and detach one provider-owned retry policy.
 * @param config - optional provider configuration; omission selects normal defaults.
 * @param path - diagnostic path naming the provider config that owns the value.
 * @returns an immutable policy safe to capture in provider registration state.
 */
export function resolveRetryPolicy(
  config: RetryPolicyConfig | undefined,
  path: string,
): ResolvedRetryPolicy {
  return resolveMode(config ?? { mode: 'normal' }, path)
}

function resolveMode(config: RetryPolicyConfig, path: string): ResolvedRetryPolicy {
  switch (config.mode) {
    case 'normal': {
      validateKeys(config, NORMAL_POLICY_KEYS, path)
      // Schemastery materializes an omitted array as `[]`, so emptiness is the
      // only "not configured" signal that survives config validation; a route
      // disables retries with `maxRetries: 0`, not an empty schedule.
      const scheduled = config.retryDelaysMs !== undefined && config.retryDelaysMs.length > 0
        ? config.retryDelaysMs
        : undefined
      if (scheduled !== undefined && config.backoff !== undefined) {
        throw new Error(`${path}: retryDelaysMs and backoff are mutually exclusive delay sources`)
      }
      // Configuring `backoff` selects the exponential ramp; every other route
      // runs the explicit schedule, which is also the shipped default.
      const retryDelaysMs = config.backoff === undefined
        ? resolveRetryDelays(scheduled, path)
        : undefined
      const maxRetries = config.maxRetries ?? retryDelaysMs?.length ?? DEFAULT_MAX_RETRIES
      const retryableCodes = config.retryableCodes ?? [...DEFAULT_RETRYABLE_CODES]
      if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
        throw new Error(`${path}.maxRetries must be a non-negative safe integer`)
      }
      if (retryDelaysMs !== undefined && maxRetries > retryDelaysMs.length) {
        throw new Error(
          `${path}.maxRetries must not exceed the ${retryDelaysMs.length} configured retryDelaysMs entries`,
        )
      }
      if (retryableCodes.length === 0) {
        throw new Error(`${path}.retryableCodes must not be empty`)
      }
      if (retryableCodes.some(code => typeof code !== 'string' || code.length === 0)) {
        throw new Error(`${path}.retryableCodes must contain only non-empty strings`)
      }
      if (new Set(retryableCodes).size !== retryableCodes.length) {
        throw new Error(`${path}.retryableCodes must not contain duplicates`)
      }
      return Object.freeze({
        mode: 'normal',
        maxRetries,
        retryableCodes: Object.freeze([...retryableCodes]),
        retryDelaysMs,
        ...resolveBackoff(
          config.backoff,
          `${path}.backoff`,
          // A scheduled policy must accept the longest wait it schedules, and a
          // provider `Retry-After` up to that bound, instead of the exponential
          // default that would reject its own later entries.
          retryDelaysMs === undefined ? DEFAULT_MAX_DELAY_MS : Math.max(...retryDelaysMs),
        ),
      })
    }
    case 'always':
      validateKeys(config, ALWAYS_POLICY_KEYS, path)
      return Object.freeze({
        mode: 'always',
        ...resolveBackoff(config.backoff, `${path}.backoff`, DEFAULT_MAX_DELAY_MS),
      })
    default:
      throw new Error(`${path}.mode must be "normal" or "always"`)
  }
}
