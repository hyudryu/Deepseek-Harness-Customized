/** Bounded, shell-free child-process invocation shared by the plugin and its helper. */
import { execFile } from 'node:child_process'

/** Capture bound for one command's output; a runaway command is truncated, not buffered without limit. */
const MAX_CAPTURE_BYTES = 2_000_000

/** Exit code reported for a command that could not be started at all. */
export const COMMAND_NOT_FOUND = 127

/** Exit code reported for a command killed by its timeout. */
export const COMMAND_TIMED_OUT = 124

/**
 * Run one command without a shell and resolve with its outcome rather than
 * throwing, so a failing git probe is data the caller can report. Arguments
 * are passed as an array, so no value is ever re-parsed by a shell.
 * @param command - executable name or absolute path.
 * @param args - argument vector, passed verbatim.
 * @param options - working directory, timeout, and environment override.
 * @returns the exit code and captured output; `ok` is true only for exit 0.
 */
export function runCommand(command, args, options = {}) {
  const { cwd, timeoutMs, env } = options
  return new Promise((settle) => {
    execFile(command, args, {
      ...cwd === undefined ? {} : { cwd },
      ...timeoutMs === undefined ? {} : { timeout: timeoutMs },
      ...env === undefined ? {} : { env },
      maxBuffer: MAX_CAPTURE_BYTES,
      windowsHide: true,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      const out = typeof stdout === 'string' ? stdout : ''
      const err = typeof stderr === 'string' ? stderr : ''
      if (error === null) {
        settle({ ok: true, code: 0, stdout: out, stderr: err })
        return
      }
      // A missing executable reports ENOENT, a timeout reports a kill with no
      // numeric code, and an ordinary non-zero exit reports its own number.
      const code = typeof error.code === 'number'
        ? error.code
        : error.code === 'ENOENT'
          ? COMMAND_NOT_FOUND
          : error.killed === true || error.signal !== null && error.signal !== undefined
            ? COMMAND_TIMED_OUT
            : 1
      settle({ ok: false, code, stdout: out, stderr: err === '' ? String(error.message) : err })
    })
  })
}
