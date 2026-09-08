import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { UsageSummary } from '../src/types.ts'

it('reports provider usage recorded through the shipped headless profile', async () => {
  const driver = fileURLToPath(new URL('./fixtures/driver.ts', import.meta.url))
  let output: UsageSummary | undefined
  await runLoaderSmoke({
    label: 'usage controller composition', tempDirPrefix: 'usage-e2e-',
    binScript: driver, libBinScript: driver,
    configPath: fileURLToPath(new URL('./fixtures/usage.patch.yml', import.meta.url)),
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
    inspect: async (cwd) => { output = JSON.parse(await readFile(join(cwd, 'usage.json'), 'utf8')) as UsageSummary },
  })
  expect(output).toMatchObject({ totalTokens: 28, peakDailyTokens: 28, sessions: 1, missingUsageAttempts: 0 })
  expect(output?.days).toHaveLength(1)
  expect(output?.days[0]).toMatchObject({ provider: 'cli-mock', model: 'cli-mock', tokens: 28 })
  expect(output?.days[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
