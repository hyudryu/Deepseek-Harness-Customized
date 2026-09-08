/** Boot the shipped headless composition and persist its usage response for inspection. */
import { writeFile } from 'node:fs/promises'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type {} from '../../src/index.ts'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('usage driver requires a config path')
const ctx = await bootProductionProfile({
  binName: 'usage-e2e', profile: 'headless', overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  await runFixtureTurn(ctx, { task: 'Prove recorded token usage.' })
  await ctx.sessionPersistence.flush()
  await writeFile('./usage.json', JSON.stringify(await ctx.usageController.summary()))
} finally {
  await ctx.fiber.dispose()
}
