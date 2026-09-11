/**
 * Project-level system prompt override.
 *
 * A session in a project that has a saved override gets that text as its whole
 * system prompt instead of the deployment-assembled one. The override is a
 * plain-text file in the project directory, the same shape the project-secrets
 * plugin uses, so the browser modal and the model read one durable source.
 *
 * The replacement happens on the `system-prompt/assemble` waterfall, which runs
 * for every model step and whose return value is authoritative. Tool schemas,
 * runtime contexts, and prompt variables still assemble normally: only the
 * section list that renders the system field is replaced.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'

export const name = 'project-system-prompt'
export const inject = ['systemPrompt', 'webServer', 'workspaceRegistry']

/** Section name of the replacement prompt, visible in `request/header` snapshots. */
const OVERRIDE_SECTION = 'project:system-prompt-override'

/** Numeric config validation: positive integer or an actionable throw. */
function positiveInt(value, fallback, label) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`)
  return value
}

/** Absolute override-file path for one project directory. */
export function resolvePromptPath(projectDir, promptFile, root) {
  const base = root === '' ? projectDir : resolve(root, projectDir)
  if (typeof promptFile !== 'string' || promptFile.trim() === '') {
    throw new Error('promptFile must be a non-empty string')
  }
  return isAbsolute(promptFile) ? promptFile : resolve(base, promptFile)
}

/** Bound override text to the configured maximum byte length. */
export function normalizePromptText(text, maxBytes) {
  if (typeof text !== 'string') throw new Error('system prompt must be a string')
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`system prompt exceeds ${maxBytes} bytes`)
  }
  return text
}

/** Atomic write: temp file in the same directory, then rename over the target. */
async function writePromptFile(filePath, text) {
  await mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.tmp`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, filePath)
}

/**
 * Read the override file, honoring the mtime/size stamp so an unchanged file is
 * not re-read on every model step. A missing file yields an empty string.
 */
async function readPromptFile(filePath, maxBytes, cache) {
  let stats
  try {
    stats = await stat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      cache.delete(filePath)
      return ''
    }
    throw error
  }
  const cached = cache.get(filePath)
  if (cached !== undefined && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.text
  }
  const text = await readFile(filePath, 'utf8')
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`system prompt exceeds ${maxBytes} bytes`)
  }
  cache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, text })
  return text
}

/** The project directory one assembly belongs to, or undefined outside a session. */
export function projectDirFor(context) {
  const cwd = context?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/** Resolve a workspace id to its project directory path. */
function workspacePathFor(ctx, workspaceId) {
  const workspace = ctx.workspaceRegistry?.get?.(workspaceId)
  if (!workspace || typeof workspace.path !== 'string') {
    throw new Error(`unknown system prompt workspace ${JSON.stringify(workspaceId)}`)
  }
  return workspace.path
}

/** One JSON response with an explicit status. */
function respond(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

export function apply(ctx, rawConfig = {}) {
  const config = {
    promptFile: typeof rawConfig.promptFile === 'string' && rawConfig.promptFile.trim() !== ''
      ? rawConfig.promptFile
      : '.dsh/system-prompt.md',
    maxBytes: positiveInt(rawConfig.maxBytes, 200000, 'maxBytes'),
    root: typeof rawConfig.root === 'string' ? rawConfig.root : '',
  }
  const cache = new Map()

  // Registered on the plugin's own unscoped context, so it receives every
  // assembly: scope filtering admits untagged listeners globally, and the
  // assembly context carries the agent whose session names the project.
  ctx.effect(() => ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const built = await next()
    const projectDir = projectDirFor(context)
    if (projectDir === undefined) return built
    const text = await readPromptFile(
      resolvePromptPath(projectDir, config.promptFile, config.root),
      config.maxBytes,
      cache,
    )
    if (text.trim() === '') return built
    return { ...built, sections: [{ name: OVERRIDE_SECTION, text }] }
  }), 'project-system-prompt: assembly override')

  // HTTP routes for the browser modal: GET/PUT /project-system-prompt/<workspaceId>.
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/project-system-prompt',
    async handler(req, res) {
      const url = new URL(req.url ?? '/', 'http://x')
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length < 2) return respond(res, 400, { ok: false, error: 'workspace id required' })
      const workspaceId = parts[1]

      let filePath
      try {
        filePath = resolvePromptPath(workspacePathFor(ctx, workspaceId), config.promptFile, config.root)
      } catch (error) {
        return respond(res, 404, { ok: false, error: error.message })
      }

      if (req.method === 'GET') {
        const text = await readPromptFile(filePath, config.maxBytes, cache)
        // The deployment default is what the model would receive without an
        // override; the modal offers it as the "Restore DeepSeek default"
        // baseline. Assembling without a scope keeps this listener inert, so
        // this is the prompt before any project override is applied.
        const defaultText = renderPrompt(await ctx.systemPrompt.assemble())
        return respond(res, 200, { ok: true, text, defaultText, path: filePath })
      }

      if (req.method === 'PUT') {
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (Buffer.byteLength(body, 'utf8') > config.maxBytes + 4) {
            return respond(res, 400, { ok: false, error: 'request body too large' })
          }
        }
        let parsed
        try {
          parsed = JSON.parse(body)
        } catch {
          return respond(res, 400, { ok: false, error: 'invalid JSON body' })
        }
        let text
        try {
          text = normalizePromptText(parsed?.text ?? '', config.maxBytes)
        } catch (error) {
          return respond(res, 400, { ok: false, error: error.message })
        }
        // Clearing the field removes the override rather than leaving an empty
        // file behind, so "no override" has exactly one durable representation.
        if (text.trim() === '') {
          await rm(filePath, { force: true })
        } else {
          await writePromptFile(filePath, text)
        }
        cache.delete(filePath)
        return respond(res, 200, { ok: true, cleared: text.trim() === '' })
      }

      return respond(res, 405, { ok: false, error: 'method not allowed' })
    },
  }), 'project-system-prompt: HTTP routes')
}

export const __test = { resolvePromptPath, normalizePromptText, readPromptFile, writePromptFile, projectDirFor }
