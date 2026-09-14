/** Git probes describing how one checkout compares with a remote branch. */
import { runCommand } from './exec.js'

/** Ref namespace of the remote-tracking branch an update pulls into. */
export function remoteRef(remote, branch) {
  return `refs/remotes/${remote}/${branch}`
}

/** First non-empty line of captured output, used for one-line failure reports. */
function firstLine(text) {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed
  }
  return ''
}

/** Parse `git log --format=%h%x09%s` output into commit rows. */
function parseCommitLines(text) {
  const commits = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const separator = line.indexOf('\t')
    if (separator === -1) {
      commits.push({ sha: line.trim(), subject: '' })
      continue
    }
    commits.push({ sha: line.slice(0, separator).trim(), subject: line.slice(separator + 1).trim() })
  }
  return commits
}

/**
 * Fetch one branch straight into its remote-tracking ref. The refspec is
 * written out in full rather than relying on a bare branch argument, which
 * updates `FETCH_HEAD` without a destination on some git versions and would
 * leave the comparison below reading a stale ref.
 * @param options - checkout, remote, branch, and the command timeout.
 * @returns whether the fetch succeeded and, when it did not, one line of cause.
 */
export async function fetchBranch({ checkout, remote, branch, timeoutMs, command = runCommand }) {
  const refspec = `+refs/heads/${branch}:${remoteRef(remote, branch)}`
  const result = await command(
    'git',
    ['-C', checkout, 'fetch', '--quiet', '--no-tags', remote, refspec],
    { timeoutMs },
  )
  if (result.ok) return { ok: true, message: null }
  return {
    ok: false,
    message: firstLine(result.stderr) || `git fetch ${remote} ${branch} exited ${result.code}`,
  }
}

/**
 * Compare one checkout with its remote-tracking ref for `remote/branch`.
 *
 * Every probe is independent and non-fatal: an unavailable repository, a
 * detached HEAD, or a missing remote branch reports `unknown` with a reason
 * instead of throwing, so the caller can render a status the user can act on.
 * @param options - checkout path, remote, branch, timeout, and commit-list bound.
 * @returns the comparison, including how many local changes an update would stash.
 */
export async function readCheckoutStatus({
  checkout, remote, branch, timeoutMs, commitLimit, command = runCommand,
}) {
  const gitAt = (directory, args) => command('git', ['-C', directory, ...args], { timeoutMs })
  const unknown = (reason, root = checkout) => ({
    state: 'unknown',
    reason,
    checkout: root,
    currentBranch: null,
    localSha: null,
    remoteSha: null,
    behind: 0,
    commits: [],
    changes: 0,
  })

  const toplevel = await gitAt(checkout, ['rev-parse', '--show-toplevel'])
  if (!toplevel.ok) return unknown('not-a-repository')
  const root = toplevel.stdout.trim() === '' ? checkout : toplevel.stdout.trim()

  const [head, symbolic, dirty, remoteRev] = await Promise.all([
    gitAt(root, ['rev-parse', 'HEAD']),
    gitAt(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    gitAt(root, ['status', '--porcelain', '--untracked-files=normal']),
    gitAt(root, ['rev-parse', '--verify', '--quiet', remoteRef(remote, branch)]),
  ])

  const localSha = head.ok ? head.stdout.trim() : ''
  if (localSha === '') return unknown('no-commits', root)
  const currentBranch = symbolic.ok ? symbolic.stdout.trim() : null
  const changes = dirty.ok
    ? dirty.stdout.split('\n').filter(line => line.trim() !== '').length
    : 0
  const remoteSha = remoteRev.ok ? remoteRev.stdout.trim() : ''
  if (remoteSha === '') {
    return { ...unknown('remote-branch-missing', root), localSha, currentBranch, changes }
  }

  const counted = await gitAt(root, ['rev-list', '--count', `HEAD..${remoteRef(remote, branch)}`])
  const parsed = counted.ok ? Number.parseInt(counted.stdout.trim(), 10) : 0
  const behind = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
  const logged = behind > 0
    ? await gitAt(root, ['log', `--max-count=${commitLimit}`, '--format=%h%x09%s', `HEAD..${remoteRef(remote, branch)}`])
    : { ok: true, stdout: '' }

  return {
    state: behind > 0 ? 'behind' : 'current',
    reason: null,
    checkout: root,
    currentBranch,
    localSha,
    remoteSha,
    behind,
    commits: logged.ok ? parseCommitLines(logged.stdout) : [],
    changes,
  }
}
