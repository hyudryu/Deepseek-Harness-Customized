/** Built web composition coverage for the fifth settings tab and persisted usage. */
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'

it('shows Usage fifth and refreshes charts from persisted sessions', async () => {
  const scaffold = await launchWebScaffold({})
  try {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'en-US', colorScheme: 'dark' })
      const instant = Date.UTC(2026, 8, 7, 12)
      await page.clock.setFixedTime(instant)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
      const navigation = dialog.locator('nav').getByRole('button')
      expect(await navigation.allTextContents()).toEqual(['General', 'Models', 'Plugins', 'Agent presets', 'Usage'])
      await dialog.getByRole('button', { name: 'Usage', exact: true }).click()
      await dialog.getByText('No recorded token usage yet. Start a conversation to see your activity here.').waitFor()
      const id = SessionId('usage-dashboard-browser')
      const session = scaffold.ctx.sessions.create(id)
      session.append('turn/start', { turn: 1 })
      session.append('step/start', { turn: 1, step: 1 })
      session.append('assistant/message', {
        turn: 1, step: 1, stream: [], usage: { inputTokens: 800, outputTokens: 200 },
        message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'fixture', model: 'Usage model' } }),
      }, { surfaceOp: 'append' })
      session.append('step/end', { turn: 1, step: 1 })
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
      const handle = await scaffold.ctx.sessionPersistence.create({
        version: SESSION_FORMAT_VERSION, id, createdAt: instant, isSeeded: false,
        cwd: scaffold.workspaceCwd, delegationDepth: 0,
      })
      try { await handle.append(session.snapshotEvents().map((event, index) => ({ ...event, time: instant + index }))) }
      finally { await handle.close() }
      await dialog.getByRole('button', { name: 'Refresh', exact: true }).click()
      await dialog.getByRole('img', { name: 'Daily token trend', exact: true }).waitFor()
      expect(await dialog.locator('dl').textContent()).toContain('1K')
      expect(await dialog.getByRole('region', { name: 'Model usage', exact: true }).textContent()).toContain('Usage model')
      for (const name of ['Weekly', 'Cumulative', 'Daily', 'Last 30 days', 'Last 7 days']) {
        const button = dialog.getByRole('button', { name, exact: true })
        await button.click()
        expect(await button.getAttribute('aria-pressed')).toBe('true')
      }
      await compareOrRefreshGolden(
        join(process.cwd(), 'apps/web/tests/expected/usage-settings/dashboard.expected.md'),
        await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd),
        webSnapshotMode(),
      )
      await page.screenshot({ path: join(process.cwd(), 'usage-dashboard-preview.png'), fullPage: true })
      const overflow = await dialog.evaluate(element => element.scrollWidth > element.clientWidth)
      expect(overflow).toBe(false)
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})
