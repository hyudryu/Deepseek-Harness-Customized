/** DeepSeek Harness home resolution, mirroring `@deepseek-ai/dsh-home-paths`. */
import { createHash } from 'node:crypto'
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
 *
 * The directory is namespaced by the checkout it describes, because several
 * profiles can share one harness home while serving different checkouts. A
 * shared directory would let one profile's poll overwrite another's relaunch
 * identity, and let a request written for one checkout be executed against
 * another.
 * @param checkout - absolute checkout this state belongs to.
 * @param env - environment mapping read for `DSH_HOME`.
 * @returns the absolute state directory.
 */
export function updateStateDir(checkout, env = process.env) {
  return join(resolveDshHome(env), 'software-update', checkoutKey(checkout))
}

/**
 * Stable directory name for one checkout.
 *
 * The path is normalized so the same checkout always maps to the same key:
 * separators become `/`, and Windows comparisons ignore case. The key is a
 * digest rather than the path itself so the directory name cannot collide two
 * checkouts that differ only in a character the filesystem rejects.
 * @param checkout - absolute checkout path.
 * @returns a short lowercase hexadecimal key.
 */
export function checkoutKey(checkout) {
  const normalized = resolve(checkout).replaceAll('\\', '/')
  const canonical = process.platform === 'win32' ? normalized.toLowerCase() : normalized
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}
