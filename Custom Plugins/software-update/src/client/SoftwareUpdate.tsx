/**
 * Sidebar software-update control.
 *
 * The trigger renders only while the tracked branch carries commits this
 * checkout lacks, so it is absent rather than disabled when there is nothing
 * to do. Confirming starts the update in a detached helper; from then on this
 * component polls the restarted server, drops the browser's caches, and
 * reloads the page once the helper reports a terminal outcome.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  Button,
  IconDownloadOutline16,
  IconRefreshOutline16,
  Modal,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Cadence used until the first response arrives.
 *
 * These are fallbacks, not the settings: the host resolves the real values from
 * its own configuration and reports them with every status, so a deployment
 * that changes its update budget changes the control's cadence with it.
 */
const FALLBACK_TIMING = {
  discoveryMs: 45_000,
  outcomeMs: 3_000,
  slowAfterMs: 45 * 60_000,
  waitTimeoutMs: 45 * 60_000,
}

/** How the host reports its resolved polling cadence. */
export interface SoftwareUpdateTiming {
  /** Interval between checkout comparisons while nothing is running. */
  discoveryMs: number
  /** Interval between checks for the restarted server. */
  outcomeMs: number
  /** How long a normal update may take before the dialog says it is slow. */
  slowAfterMs: number
  /** How long the dialog waits before it stops expecting an answer. */
  waitTimeoutMs: number
}

/** Commit rows the dialog lists before it summarizes the rest. */
const COMMIT_ROWS = 8

/** One commit the update would bring in. */
export interface SoftwareUpdateCommit {
  /** Abbreviated commit id. */
  sha: string
  /** First line of the commit message. */
  subject: string
}

/** Helper progress and outcome for the most recent update. */
export interface SoftwareUpdateOutcome {
  state: 'running' | 'done' | 'failed' | 'unknown'
  startedAt: string | null
  finishedAt: string | null
  fromSha: string | null
  toSha: string | null
  previousBranch: string | null
  step: string | null
  message: string | null
  stashKept: boolean
}

/** The host's comparison of this checkout with the tracked branch. */
export interface SoftwareUpdateStatus {
  state: 'behind' | 'current' | 'unknown'
  reason: string | null
  checkout: string
  currentBranch: string | null
  localSha: string | null
  remoteSha: string | null
  behind: number
  commits: SoftwareUpdateCommit[]
  changes: number
  remote: string
  branch: string
  /** Sessions whose turns the restart would interrupt and then continue. */
  runningSessions: number
  /** The host's resolved polling cadence. */
  polling?: SoftwareUpdateTiming
  /** Why this launch cannot be updated in place, when it cannot. */
  unsupportedReason?: string | null
  fetchError: string | null
  canUpdate: boolean
  update: SoftwareUpdateOutcome | null
}

/** Framework shares for the Settings-adjacent action. */
export type SoftwareUpdateProps =
  PropsRuntime<'sidebar.settings.action'> & PropsLocale<'softwareUpdate'>

/** Where the control is in its own lifecycle. */
type Phase = 'idle' | 'starting' | 'waiting'

const TRIGGER_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 42,
  height: 42,
  padding: 0,
  border: 'none',
  borderRadius: 12,
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
}

const LEAD_STYLE: CSSProperties = { margin: '0 0 8px' }
const NOTE_STYLE: CSSProperties = { margin: '8px 0 0', fontSize: 12, opacity: 0.75 }
const ERROR_STYLE: CSSProperties = {
  margin: '8px 0 0',
  fontSize: 12,
  color: 'var(--dsw-color-error, #d00)',
}
const LIST_STYLE: CSSProperties = { margin: '4px 0 0', padding: 0, listStyle: 'none', fontSize: 12 }
const ROW_STYLE: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, margin: 0 }
const COMMIT_STYLE: CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '2px 0',
  alignItems: 'baseline',
}
const SHA_STYLE: CSSProperties = { opacity: 0.7, fontSize: 11, flexShrink: 0 }
const BADGE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 20,
  padding: '0 6px',
  borderRadius: 10,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  fontSize: 11,
  fontWeight: 600,
}

/**
 * Read the host's comparison. A rejection means the server is unreachable or
 * the browser is not authenticated; the caller keeps its last known status.
 * @returns the current status document.
 */
async function readStatus(): Promise<SoftwareUpdateStatus> {
  const response = await fetch('/software-update', { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error(`Software update status failed: ${String(response.status)}`)
  return await response.json() as SoftwareUpdateStatus
}

/**
 * Ask the host to start the update.
 * @returns the update's start timestamp, which identifies its outcome record.
 */
/** Ask the host to start the update, reporting the host's own refusal code. */
async function requestUpdate(): Promise<string> {
  const response = await fetch('/software-update', { method: 'POST', credentials: 'same-origin' })
  const body = await response.json().catch(() => null) as { startedAt?: unknown; error?: unknown } | null
  if (!response.ok || typeof body?.startedAt !== 'string') {
    // The host names why it refused; the dialog turns that into copy the user
    // can act on rather than one generic failure message.
    throw new Error(typeof body?.error === 'string' ? body.error : 'update-request-failed')
  }
  return body.startedAt
}

/**
 * Drop everything the browser could serve from before the update, then reload
 * so the page is built from the freshly generated assets.
 */
async function reloadWithFreshCache(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      for (const key of await caches.keys()) await caches.delete(key)
    }
  } catch {
    // Cache Storage is unavailable in this context; the reload below is still
    // the correct outcome and no later step depends on the deletion.
  }
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        await registration.unregister()
      }
    }
  } catch {
    // No service worker controls this page, which is the normal case here; the
    // reload below is still the correct outcome.
  }
  window.location.reload()
}

/**
 * Render the update trigger and the dialog it opens.
 * @param props - Framework locale seat; this action reads no owner state.
 * @returns the trigger button and its body-portaled dialog, or nothing when no update exists.
 */
export function SoftwareUpdate({ t }: SoftwareUpdateProps) {
  const [status, setStatus] = useState<SoftwareUpdateStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [pending, setPending] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [gaveUp, setGaveUp] = useState(false)

  // The host owns the cadence; until its first response arrives the control
  // polls at a fallback, then adopts whatever the deployment configured.
  const timing = status?.polling ?? FALLBACK_TIMING

  // Discovery stops once an update is running: the outcome poll owns the
  // endpoint from then on, and the checkout is mid-change anyway.
  useEffect(() => {
    if (phase !== 'idle') return
    let live = true
    const load = (): void => {
      readStatus().then(
        (value) => { if (live) setStatus(value) },
        // An unreachable or unauthenticated server offers no update; the next
        // tick retries rather than reporting a failure the user cannot act on.
        () => { if (live) setStatus(null) },
      )
    }
    load()
    const timer = setInterval(load, timing.discoveryMs)
    return () => { live = false; clearInterval(timer) }
  }, [phase, timing.discoveryMs])

  // The outcome record is the only signal that the restarted server is really
  // serving the new build, so the reload waits for it rather than for any
  // successful request. Polling continues past the timeout: a slow first build
  // still ends in a reload.
  useEffect(() => {
    if (pending === null) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // `slowAfterMs` is the deployment's expectation of a normal update, so it
    // drives the "taking longer than expected" message; `waitTimeoutMs` is the
    // point past which the dialog stops claiming it will reload on its own.
    const startedAt = Date.parse(pending)
    const slowAt = Number.isFinite(startedAt) ? startedAt + timing.slowAfterMs : Number.POSITIVE_INFINITY
    const giveUpAt = Number.isFinite(startedAt) ? startedAt + timing.waitTimeoutMs : Number.POSITIVE_INFINITY
    const tick = async (): Promise<void> => {
      if (!live) return
      if (Date.now() > giveUpAt) {
        setGaveUp(true)
        return
      }
      if (Date.now() > slowAt) setSlow(true)
      try {
        const value = await readStatus()
        if (!live) return
        const outcome = value.update
        if (outcome !== null && outcome.startedAt === pending
          && (outcome.state === 'done' || outcome.state === 'failed')) {
          await reloadWithFreshCache()
          return
        }
      } catch {
        // The server is down for the whole install and build, which is exactly
        // the state this poll exists to wait out; the next tick retries.
      }
      if (live) timer = setTimeout(() => { void tick() }, timing.outcomeMs)
    }
    timer = setTimeout(() => { void tick() }, timing.outcomeMs)
    return () => {
      live = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [pending, timing.outcomeMs, timing.slowAfterMs, timing.waitTimeoutMs])

  const openDialog = useCallback(() => {
    setStartError(null)
    setOpen(true)
    readStatus().then(
      (value) => { setStatus(value) },
      // The dialog keeps the status it already has; a failed refresh must not
      // blank the commits the user is about to confirm.
      () => undefined,
    )
  }, [])

  const confirm = useCallback(() => {
    setStartError(null)
    setPhase('starting')
    requestUpdate().then(
      (startedAt) => {
        setPending(startedAt)
        setGaveUp(false)
        setPhase('waiting')
      },
      (error: unknown) => {
        setStartError(error instanceof Error ? error.message : 'update-request-failed')
        setPhase('idle')
      },
    )
  }, [])

  const running = phase !== 'idle'
  const behind = status !== null && status.state === 'behind' && status.behind > 0
  if (!behind && !running) return null

  const shown = status === null ? [] : status.commits.slice(0, COMMIT_ROWS)
  const update = status?.update ?? null

  return <>
    <Tooltip label={t('trigger')}>
      <button
        type="button"
        style={TRIGGER_STYLE}
        aria-label={t('trigger')}
        onClick={openDialog}
      >
        {running ? <IconRefreshOutline16 size={20} /> : <IconDownloadOutline16 size={20} />}
      </button>
    </Tooltip>
    <Modal
      open={open}
      onClose={() => { if (!running) setOpen(false) }}
      title={t('title')}
      closeLabel={t('close')}
      footer={running ? undefined : (
        <>
          <Button onClick={() => { setOpen(false) }}>{t('cancel')}</Button>
          <Button
            variant="primary"
            disabled={status === null || !status.canUpdate}
            onClick={confirm}
          >
            {t('update')}
          </Button>
        </>
      )}
    >
      {running ? (
        <p style={LEAD_STYLE}>
          {phase === 'starting' ? t('starting') : gaveUp ? t('gaveUp') : slow ? t('slow') : t('waiting')}
        </p>
      ) : status !== null && (
        <>
          <p style={LEAD_STYLE}>{t('available')}</p>
          <p style={ROW_STYLE}>
            <span>{t('commits')}</span>
            <span style={BADGE_STYLE}>{status.behind}</span>
          </p>
          <ul style={LIST_STYLE}>
            {shown.map(commit => (
              <li key={commit.sha} style={COMMIT_STYLE}>
                <code style={SHA_STYLE}>{commit.sha}</code>
                <span>{commit.subject}</span>
              </li>
            ))}
          </ul>
          {status.behind > shown.length && <p style={NOTE_STYLE}>{t('truncated')}</p>}
          {status.changes > 0 && (
            <p style={NOTE_STYLE}>
              {t('changed')} <span style={BADGE_STYLE}>{status.changes}</span> — {t('changedNote')}
            </p>
          )}
          {status.currentBranch !== null && status.currentBranch !== status.branch && (
            <p style={NOTE_STYLE}>{t('switchBranch')} <code>{status.branch}</code></p>
          )}
          {status.runningSessions > 0 && <p style={NOTE_STYLE}>{t('sessionsContinue')}</p>}
          {status.unsupportedReason === 'ephemeral-port' && (
            <p style={NOTE_STYLE}>{t('ephemeralPort')}</p>
          )}
          {startError !== null && (
            <p role="alert" style={ERROR_STYLE}>
              {startError === 'fetch-failed' ? t('fetchFailed')
                : startError === 'ephemeral-port' ? t('ephemeralPort')
                  : t('startFailed')}
            </p>
          )}
          {update !== null && update.state !== 'running' && (
            <p style={NOTE_STYLE} role={update.state === 'failed' ? 'alert' : undefined}>
              {update.state === 'done' ? t('lastDone')
                : update.state === 'failed' ? t('lastFailed')
                  // A record this build cannot interpret is not a success: the
                  // parser keeps `unknown` precisely so it is never rendered as
                  // one.
                  : t('lastUnknown')}
              {update.stashKept ? ` ${t('stashKept')}` : ''}
              {update.message !== null ? ` ${update.message}` : ''}
            </p>
          )}
        </>
      )}
    </Modal>
  </>
}
