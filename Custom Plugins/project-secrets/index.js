import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'

export const name = 'project-secrets'
export const inject = ['tools', 'skills', 'webServer', 'workspaceRegistry']

const SKILL_CONTENT = readFileSync(new URL('./skills/project-secrets.md', import.meta.url), 'utf8')

/** Producer name of the runtime-context contribution. */
const CONTEXT_NAME = 'project-secrets'
/** Runtime-context position: after the shipped contributions, which occupy 110-120. */
const CONTEXT_ORDER = 130
/** Bound on how many key names one contribution advertises. */
const MAX_CONTEXT_KEYS = 40
/** Bound on one advertised key name, so a stray long line cannot flood the prompt. */
const MAX_CONTEXT_KEY_CHARS = 60

/** Numeric config validation: positive integer or an actionable throw. */
function positiveInt(value, fallback, name) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

/** Absolute secrets-file path for a workspace project directory. */
function resolveSecretsPath(workspacePath, secretsFile, root) {
  const base = root === '' ? workspacePath : resolve(root, workspacePath)
  if (typeof secretsFile !== 'string' || secretsFile.trim() === '') {
    throw new Error('secretsFile must be a non-empty string')
  }
  return isAbsolute(secretsFile) ? secretsFile : resolve(base, secretsFile)
}

/** Bound the secrets text to the configured maximum byte length. */
function normalizeSecretsText(text, maxBytes) {
  if (typeof text !== 'string') throw new Error('secrets must be a string')
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`project secrets exceed ${maxBytes} bytes`)
  }
  return text
}

/** Atomic write: temp file in the same directory, then rename over the target. */
async function writeSecretsFile(filePath, text) {
  await mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, filePath)
}

/** Read the secrets file; missing file yields an empty string. */
async function readSecretsFile(filePath, maxBytes) {
  let content
  try {
    content = await readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new Error(`project secrets exceed ${maxBytes} bytes`)
  }
  return content
}

/** The same read on the prompt-assembly path, which is synchronous. */
function readSecretsFileSync(filePath, maxBytes) {
  let content
  try {
    content = readFileSync(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
  if (Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new Error(`project secrets exceed ${maxBytes} bytes`)
  }
  return content
}

/**
 * Key names a block defines: the label before the first `=` or `:` on each
 * non-empty line. Only labels are collected, so nothing derived here can carry
 * a secret value.
 */
export function secretsKeys(text) {
  const keys = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const separator = trimmed.search(/[=:]/)
    const label = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim()
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
        const text = normalizeSecretsText(args.secrets ?? '', normalized.maxBytes)
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
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (Buffer.byteLength(body, 'utf8') > normalized.maxBytes + 4) {
            return respond(res, 400, { ok: false, error: 'request body too large' })
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
  readSecretsFileSync, secretsKeys, renderSecretsContext,
}
