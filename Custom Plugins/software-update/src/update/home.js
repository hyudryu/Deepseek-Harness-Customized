/** DeepSeek Harness home resolution, mirroring `@deepseek-ai/dsh-home-paths`. */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Directory name of the default harness home under the operating-system home. */
const DSH_HOME_DIR_NAME = '.dsh'

/** Environment variable overriding the default harness home. */
const DSH_HOME_ENV = 'DSH_HOME'

/** Expand `~`, `~/`, and `~\` against the operating-system home. */
function expandHomePath(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the harness home exactly as the rest of the product does: an
 * explicit `$DSH_HOME`, then `~/.dsh`. A blank override counts as unset so it
 * can never resolve the home to the current working directory.
 * @param env - environment mapping read for `DSH_HOME`.
 * @returns the normalized absolute harness home.
 */
export function resolveDshHome(env = process.env) {
  const fromEnv = env[DSH_HOME_ENV]
  const selected = fromEnv !== undefined && fromEnv.trim().length > 0
    ? fromEnv
    : join(homedir(), DSH_HOME_DIR_NAME)
  return resolve(expandHomePath(selected))
}

/**
 * Directory holding this feature's durable files: the relaunch identity, the
 * pending update request, and the helper's progress record. It lives under the
 * harness home rather than the checkout so a `git checkout` during an update
 * cannot remove the file the helper is still writing.
 * @param env - environment mapping read for `DSH_HOME`.
 * @returns the absolute state directory.
 */
export function updateStateDir(env = process.env) {
  return join(resolveDshHome(env), 'software-update')
}
