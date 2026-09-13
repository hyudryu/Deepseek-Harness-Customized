import { randomBytes } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

export const name = 'project-secrets'
export const inject = ['tools', 'skills', 'webServer', 'workspaceRegistry', 'connection']

const SKILL_CONTENT = readFileSync(new URL('./skills/project-secrets.md', import.meta.url), 'utf8')

/** Producer name of the runtime-context contribution. */
const CONTEXT_NAME = 'project-secrets'
/** Runtime-context position: after the shipped contributions, which occupy 110-120. */
const CONTEXT_ORDER = 130
/** Bound on how many key names one contribution advertises. */
const MAX_CONTEXT_KEYS = 40
/** Bound on one advertised key name, so a stray long line cannot flood the prompt. */
const MAX_CONTEXT_KEY_CHARS = 60

/**
 * Worst-case growth of one UTF-8 byte inside a JSON string body. A control
 * character becomes a six-byte `\uXXXX` escape, and quotes and backslashes each
 * double, so a body carrying a value of exactly `maxBytes` can legitimately be
 * several times larger than the value itself. Bounding the request at
 * `maxBytes` would reject a save the secrets limit accepts.
 */
const JSON_ESCAPE_WORST_CASE = 6

/** Bytes of the `{"text":""}` envelope around the encoded secrets value. */
const REQUEST_ENVELOPE_BYTES = 64

/** Numeric config validation: positive integer or an actionable throw. */
function positiveInt(value, fallback, name) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

/**
 * Absolute secrets-file path for a workspace project directory.
 *
 * A configured `root` relocates storage, so the workspace must nest *beneath*
 * it. Passing an absolute workspace path as `resolve`'s second operand would
 * discard `root` entirely, which is what real sessions supply, so the volume
 * and any leading separators are stripped before the path is nested.
 */
function resolveSecretsPath(workspacePath, secretsFile, root) {
  const base = root === '' ? workspacePath : resolve(root, stripToRelative(workspacePath))
  if (typeof secretsFile !== 'string' || secretsFile.trim() === '') {
    throw new Error('secretsFile must be a non-empty string')
  }
  return isAbsolute(secretsFile) ? secretsFile : resolve(base, secretsFile)
}

/** Drop a drive letter and leading separators so a path can nest under a root. */
function stripToRelative(workspacePath) {
  return workspacePath.replace(/^[A-Za-z]:/, '').replace(/^[/\\]+/, '')
}

/** Bound the secrets text to the configured maximum byte length. */
function normalizeSecretsText(text, maxBytes) {
  if (typeof text !== 'string') throw new Error('secrets must be a string')
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`project secrets exceed ${maxBytes} bytes`)
  }
  return text
}

/** Largest request body whose decoded secrets value could still be within `maxBytes`. */
function requestByteLimit(maxBytes) {
  return maxBytes * JSON_ESCAPE_WORST_CASE + REQUEST_ENVELOPE_BYTES
}

/**
 * Atomic write: a uniquely named temp file in the same directory, then rename
 * over the target.
 *
 * The temp name carries random bytes rather than only the pid because two
 * writes in one process — a tool call racing a browser save — would otherwise
 * share a path, truncate each other, and leave the second rename failing with
 * `ENOENT`. The mode is set explicitly to owner-only: the process umask would
 * otherwise create the replacement world-readable, and `rename` preserves
 * whatever mode the temp file had, which would widen an existing `0600` file.
 */
async function writeSecretsFile(filePath, text) {
  await mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, filePath)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Read the secrets file; a missing file yields an empty string.
 *
 * The size is checked against the file's own metadata before it is read: this
 * runs on every prompt assembly as well as on explicit reads, so decoding an
 * oversized file first would defeat the bound it exists to enforce.
 */
async function readSecretsFile(filePath, maxBytes) {
  let size
  try {
    size = (await stat(filePath)).size
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
  if (size > maxBytes) throw new Error(`project secrets exceed ${maxBytes} bytes`)
  return await readFile(filePath, 'utf8')
}

/** The same read on the prompt-assembly path, which is synchronous. */
function readSecretsFileSync(filePath, maxBytes) {
  let size
  try {
    size = statSync(filePath).size
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
  if (size > maxBytes) throw new Error(`project secrets exceed ${maxBytes} bytes`)
  return readFileSync(filePath, 'utf8')
}

/**
 * Key names a block defines: the label before the first `=` or `:` on each
 * non-empty line. Only labels are collected, so nothing derived here can carry
 * a secret value.
 *
 * A line with no separator is skipped rather than treated as a label. A
 * multiline value — an OpenSSH key body, a wrapped token — has no `=` on its
 * continuation lines, so treating the whole line as a key name would copy the
 * secret itself into the model-visible context and the durable session log.
 */
export function secretsKeys(text) {
  const keys = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const separator = trimmed.search(/[=:]/)
    if (separator === -1) continue
    const label = trimmed.slice(0, separator).trim()
    if (label === '' || keys.includes(label)) continue
    keys.push(label.length > MAX_CONTEXT_KEY_CHARS ? `${label.slice(0, MAX_CONTEXT_KEY_CHARS)}…` : label)
    if (keys.length === MAX_CONTEXT_KEYS) break
  }
  return keys
}

/** The model-facing snapshot text advertising a non-empty block by its key names. */
export function renderSecretsContext(keys) {
  return [
    'This project keeps a project secrets block.',
    `It defines: ${keys.join(', ')}.`,
    'Call project_secrets with action "read" before reporting that you do not know a credential, host, or other connection detail for this project.',
    'Use the values it returns without repeating them back in your reply.',
  ].join('\n')
}

/** Resolve a workspace id to its project directory path. */
function workspacePathFor(ctx, workspaceId) {
  const workspace = ctx.workspaceRegistry?.get?.(workspaceId)
  if (!workspace || typeof workspace.path !== 'string') {
    throw new Error(`unknown project secrets workspace ${JSON.stringify(workspaceId)}`)
  }
  return workspace.path
}

/** The secrets file path for a workspace id. */
function pathForWorkspace(ctx, workspaceId, config) {
  return resolveSecretsPath(workspacePathFor(ctx, workspaceId), config.secretsFile, config.root)
}

export function apply(ctx, rawConfig = {}) {
  const normalized = {
    secretsFile: typeof rawConfig.secretsFile === 'string' && rawConfig.secretsFile.trim() !== ''
      ? rawConfig.secretsFile
      : '.dsh/project-secrets',
    maxBytes: positiveInt(rawConfig.maxBytes, 200000, 'maxBytes'),
    root: typeof rawConfig.root === 'string' ? rawConfig.root : '',
  }

  ctx.effect(() => ctx.skills.register({
    name: 'project-secrets',
    description: 'Read and write the project-scoped secrets block: hostnames, SSH targets, usernames, passwords, tokens, and other connection details this project needs.',
    source: 'runtime',
    content: SKILL_CONTENT,
    invocation: { modelInvocable: true, userInvocable: true },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'project_secrets',
    description: 'Read or write the project-scoped secrets block for the current project. It holds the project-specific values the repository does not: server hostnames, SSH targets, usernames, passwords, tokens, and other connection details. Read it before reporting that you do not know such a value, and do not repeat the values back.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['read', 'write'] },
        secrets: { type: 'string', description: 'Secrets text to store (required for write).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['ok', 'action'],
        properties: {
          ok: { type: 'boolean' },
          action: { type: 'string' },
          secrets: { type: 'string' },
          path: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: typeof value?.secrets === 'string' ? value.secrets : JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const cwd = exec.agent?.session?.header?.cwd ?? process.cwd()
      const filePath = resolveSecretsPath(cwd, normalized.secretsFile, normalized.root)
      if (args.action === 'read') {
        const secrets = await readSecretsFile(filePath, normalized.maxBytes)
        return { ok: true, action: 'read', secrets }
      }
      if (args.action === 'write') {
        // The schema requires only `action`, so a model can legitimately send
        // `{"action":"write"}`. Coercing that absent payload to an empty string
        // would silently erase the whole block, so absence is refused and
        // clearing stays an explicit `secrets: ""`.
        if (typeof args.secrets !== 'string') {
          throw new Error('project_secrets write requires a string "secrets" value; pass an empty string to clear the block')
        }
        const text = normalizeSecretsText(args.secrets, normalized.maxBytes)
        await writeSecretsFile(filePath, text)
        return { ok: true, action: 'write', path: filePath }
      }
      throw new Error(`unsupported project_secrets action ${args.action}`)
    },
  }))

  // Model-visible disclosure of what the block covers. The plugin is otherwise
  // pull-only: the tool is offered on every request, but nothing tells the model
  // that this project has a block at all, so a question about a value it holds
  // is answered with "I do not know". Only key names are contributed — never a
  // value — so the block stays out of the conversation and the session log.
  //
  // Registering runtime context (rather than pushing a message from a pre-step
  // listener) is what the session log expects: the agent loop materializes the
  // assembled contexts into one durable `snapshot` message, republishes it only
  // when its text changes, and treats a compaction that dropped it as eligible
  // for republication.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.context({
      name: CONTEXT_NAME,
      order: CONTEXT_ORDER,
      text: ({ agent }) => {
        const cwd = agent?.session?.header?.cwd
        if (typeof cwd !== 'string') return ''
        try {
          const filePath = resolveSecretsPath(cwd, normalized.secretsFile, normalized.root)
          const keys = secretsKeys(readSecretsFileSync(filePath, normalized.maxBytes))
          return keys.length === 0 ? '' : renderSecretsContext(keys)
        } catch {
          // An unreadable or over-limit block contributes no context; the tool
          // still reports the failure when the model asks for the values.
          return ''
        }
      },
    })
  })

  // HTTP routes for the browser modal: GET/PUT /project-secrets/<workspaceId>.
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/project-secrets',
    async handler(req, res) {
      // Named routes are dispatched ahead of the authenticated fallback, so
      // this handler authenticates for itself. Without it any peer that can
      // reach the desktop Web server could read or replace a workspace's
      // credentials. Both verbs are rejected before the workspace is resolved
      // or the secrets file is touched.
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        return respond(res, rejection, { ok: false, error: 'unauthorized' })
      }

      const url = new URL(req.url ?? '/', 'http://x')
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length < 2) return respond(res, 400, { ok: false, error: 'workspace id required' })
      const workspaceId = parts[1]

      if (req.method === 'GET') {
        let filePath
        try {
          filePath = pathForWorkspace(ctx, workspaceId, normalized)
        } catch (error) {
          return respond(res, 404, { ok: false, error: error.message })
        }
        const text = await readSecretsFile(filePath, normalized.maxBytes)
        return respond(res, 200, { ok: true, text })
      }

      if (req.method === 'PUT') {
        let filePath
        try {
          filePath = pathForWorkspace(ctx, workspaceId, normalized)
        } catch (error) {
          return respond(res, 404, { ok: false, error: error.message })
        }
        // The body is JSON, so its byte length is not the value's: escapes can
        // inflate one input byte to six. The decoded value is bounded by
        // `normalizeSecretsText` below, which is the limit that matters.
        const bodyLimit = requestByteLimit(normalized.maxBytes)
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (Buffer.byteLength(body, 'utf8') > bodyLimit) {
            return respond(res, 413, { ok: false, error: 'request body too large' })
          }
        }
        let parsed
        try {
          parsed = JSON.parse(body)
        } catch {
          return respond(res, 400, { ok: false, error: 'invalid JSON body' })
        }
        try {
          const text = normalizeSecretsText(parsed?.text ?? '', normalized.maxBytes)
          await writeSecretsFile(filePath, text)
        } catch (error) {
          return respond(res, 400, { ok: false, error: error.message })
        }
        return respond(res, 200, { ok: true })
      }

      return respond(res, 405, { ok: false, error: 'method not allowed' })
    },
  }))
}

function respond(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

export const __test = {
  resolveSecretsPath, normalizeSecretsText, readSecretsFile, writeSecretsFile,
  readSecretsFileSync, secretsKeys, renderSecretsContext, requestByteLimit,
}
