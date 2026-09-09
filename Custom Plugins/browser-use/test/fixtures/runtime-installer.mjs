import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createRuntime, normalizeConfig } from '../../index.js'
const root = process.argv[2]
const ensure = createRuntime(normalizeConfig({ venvRoot: root }), async (_command, args) => {
  if (args[0] === '-c') return '314'
  if (args[1] === 'venv') {
    await appendFile(join(root, 'installers'), `${process.pid}\n`)
    await delay(100)
    const directory = join(args[2], process.platform === 'win32' ? 'Scripts' : 'bin')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, process.platform === 'win32' ? 'python.exe' : 'python'), '')
  }
  return ''
})
await ensure()
