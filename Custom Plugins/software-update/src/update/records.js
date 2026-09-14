/** Durable files exchanging state between the plugin, its helper, and the relaunched server. */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { delay } from './delay.js'

/** Identity of the running server, written at load so a successor can relaunch it exactly. */
export const LAUNCH_FILENAME = 'launch.json'

/** The update the plugin asked the helper to perform. */
export const REQUEST_FILENAME = 'request.json'

/** The helper's progress and outcome for the most recent update. */
export const UPDATE_FILENAME = 'update.json'

/** Full command output of the most recent update, for a failure the browser cannot show. */
export const LOG_FILENAME = 'update.log'

/** Standard output and error of the relaunched server, which has no console. */
export const SERVER_LOG_FILENAME = 'server.log'

/** Sessions whose turns the update interrupts, for the successor to continue. */
export const RESUME_FILENAME = 'resume.json'

/** Absolute paths of every file this feature keeps in one state directory. */
export function statePaths(stateDir) {
  return {
    dir: stateDir,
    launch: join(stateDir, LAUNCH_FILENAME),
    request: join(stateDir, REQUEST_FILENAME),
    update: join(stateDir, UPDATE_FILENAME),
    log: join(stateDir, LOG_FILENAME),
    server: join(stateDir, SERVER_LOG_FILENAME),
    resume: join(stateDir, RESUME_FILENAME),
  }
}

/**
 * Read one JSON document, treating absence and corruption as "no document".
 * Every caller renders the missing state as "unknown" rather than failing, so
 * a half-written or hand-edited file must not take the endpoint down.
 * @param path - absolute file path.
 * @returns the parsed value, or null when it is absent or unparseable.
 */
export async function readJson(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Attempts allowed for a rename that another process is momentarily holding open. */
const RENAME_ATTEMPTS = 10

/** Milliseconds between those attempts. */
const RENAME_RETRY_MS = 20

/** Windows failures raised while a concurrent reader or indexer holds the target. */
const RENAME_CONTENTION = new Set(['EPERM', 'EACCES', 'EBUSY'])

/**
 * Rename over an existing file, retrying the brief contention Windows reports
 * when another process holds the target open. POSIX renames are atomic and
 * succeed on the first attempt; this loop exists for the reader that is
 * genuinely concurrent with the writer, not to mask a persistent failure.
 */
async function replaceFile(temporary, path) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(temporary, path)
      return
    } catch (error) {
      if (attempt >= RENAME_ATTEMPTS || !RENAME_CONTENTION.has(error?.code)) throw error
      await delay(RENAME_RETRY_MS)
    }
  }
}

/**
 * Write one JSON document through a unique temporary file in the same
 * directory, then rename over the target, so a reader never observes a
 * partial document.
 * @param path - absolute file path.
 * @param value - JSON-serializable value.
 */
export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await replaceFile(temporary, path)
  } catch (error) {
    // The temporary file is this call's own residue; the original error is
    // the one the caller needs, so a failed cleanup is discarded.
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Describe the currently running server so the helper can restart it without
 * guessing a launcher, a package manager, or a shell.
 * @param overrides - resolved checkout and any recorded identity fields.
 * @returns the launch record to persist.
 */
export function launchRecord(overrides = {}) {
  return {
    version: 1,
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
    execPath: process.execPath,
    execArgv: [...process.execArgv],
    // `process.argv[1]` is the resolved entry module; re-running it with the
    // same execArgv reproduces this launch with or without a package-manager
    // shim on PATH.
    argv: process.argv.slice(1),
    node: process.version,
    platform: process.platform,
    ...overrides,
  }
}

/** Update states the helper can commit; anything else means the file is not ours. */
const UPDATE_STATES = new Set(['running', 'done', 'failed'])

/**
 * Project the helper's on-disk record onto the fields the browser may read.
 * Every field is checked rather than passed through: the record is a durable
 * file another process writes, so it is a parser boundary.
 * @param value - the parsed `update.json` value, or null.
 * @returns the wire record, or null when nothing usable was stored.
 */
export function normalizeUpdateRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const text = field => (typeof value[field] === 'string' && value[field] !== '' ? value[field] : null)
  return {
    state: UPDATE_STATES.has(value.state) ? value.state : 'unknown',
    startedAt: text('startedAt'),
    finishedAt: text('finishedAt'),
    fromSha: text('fromSha'),
    toSha: text('toSha'),
    previousBranch: text('previousBranch'),
    step: text('step'),
    message: text('message'),
    stashKept: value.stashKept === true,
  }
}

/**
 * Whether a launch record can be replayed.
 * @param record - candidate record read from disk.
 * @returns true only when it carries a usable executable and entry module.
 */
export function isReplayableLaunch(record) {
  return record !== null
    && typeof record === 'object'
    && typeof record.execPath === 'string' && record.execPath !== ''
    && Array.isArray(record.argv) && record.argv.length > 0
    && record.argv.every(entry => typeof entry === 'string')
    && Array.isArray(record.execArgv) && record.execArgv.every(entry => typeof entry === 'string')
    && typeof record.cwd === 'string' && record.cwd !== ''
}
