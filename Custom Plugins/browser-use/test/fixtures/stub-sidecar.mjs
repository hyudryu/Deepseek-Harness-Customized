/** Stub sidecar for tests: same NDJSON protocol as python/sidecar.py. */
import { createInterface } from 'node:readline'

const rl = createInterface({ input: process.stdin })

function reply(id, ok, payload) {
  process.stdout.write(`${JSON.stringify({ id, ok, ...(ok ? { result: payload } : { error: payload }) })}\n`)
}

rl.on('line', line => {
  if (line.trim() === '') return
  let request
  try { request = JSON.parse(line) } catch { return }
  const { id, method, params } = request
  if (method === 'ping') {
    reply(id, true, { version: 'stub' })
  } else if (method === 'run') {
    if (!params.task || !params.task.trim()) {
      reply(id, false, 'run requires a nonempty task')
      return
    }
    reply(id, true, {
      done: true,
      final_result: `did: ${params.task}`,
      errors: [],
      steps: [{ step: 1, action: 'navigate', result: 'ok' }],
      url: 'https://example.com/',
      elapsed_s: 0.1,
      screenshot_path: 'stub-shot.png',
    })
  } else if (method === 'hang') {
    // Deliberately never replies: used to observe mid-flight process death.
  } else if (method === 'fail') {
    reply(id, false, 'requested failure')
  } else if (method === 'log-event') {
    process.stdout.write(`${JSON.stringify({ event: 'log', message: 'progress' })}\n`)
    reply(id, true, {})
  } else if (method === 'not-json-followed-by-reply') {
    process.stdout.write('this line is not json\n')
    reply(id, true, { ok: true })
  } else {
    reply(id, false, `unknown method: ${method}`)
  }
})
