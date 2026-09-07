/** Built web composition coverage for the fifth settings tab and persisted usage. */
import { mkdir, mkdtemp } from 'node:fs/promises'
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
      for (const sample of [
        { id: 'usage-dashboard-yesterday', time: instant - 86_400_000, usage: { inputTokens: 800, outputTokens: 200, totalTokens: 1400 } },
        { id: 'usage-dashboard-today', time: instant, usage: { inputTokens: 100, outputTokens: 100 } },
      ]) {
        const id = SessionId(sample.id)
        const session = scaffold.ctx.sessions.create(id)
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('assistant/message', {
          turn: 1, step: 1, stream: [], usage: sample.usage,
          message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: 'fixture', model: 'Usage model' } }),
        }, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        const handle = await scaffold.ctx.sessionPersistence.create({
          version: SESSION_FORMAT_VERSION, id, createdAt: sample.time, isSeeded: false,
          cwd: scaffold.workspaceCwd, delegationDepth: 0,
        })
        try { await handle.append(session.snapshotEvents().map((event, index) => ({ ...event, time: sample.time + index }))) }
        finally { await handle.close() }
      }
      await dialog.getByRole('button', { name: 'Refresh', exact: true }).click()
      await dialog.getByRole('img', { name: 'Daily token trend', exact: true }).waitFor()
      expect(await dialog.locator('dl').textContent()).toContain('1.6K')
      expect(await dialog.getByRole('region', { name: 'Model usage', exact: true }).textContent()).toContain('Usage model')
      const activity = dialog.getByRole('region', { name: 'Token activity', exact: true })
      const disclosure = activity.locator('summary')
      await disclosure.focus()
      await page.keyboard.press('Enter')
      const activityTable = activity.getByRole('table', { name: 'Activity data', exact: true })
      await activityTable.waitFor()
      expect(await activityTable.getByRole('row').count()).toBe(365)
      for (const [mode, yesterday, today] of [
        ['Weekly', '1,600', '1,600'], ['Cumulative', '1,400', '1,600'], ['Daily', '1,400', '200'],
      ] as const) {
        await activity.getByRole('button', { name: mode, exact: true }).click()
        expect(await activityTable.getByRole('rowheader', { name: '2026-09-06', exact: true }).locator('..').textContent()).toContain(yesterday)
        expect(await activityTable.getByRole('rowheader', { name: '2026-09-07', exact: true }).locator('..').textContent()).toContain(today)
      }
      await disclosure.focus()
      await page.keyboard.press('Enter')
      expect(await activityTable.isVisible()).toBe(false)
      for (const name of ['Last 30 days', 'Last 7 days']) {
        const button = dialog.getByRole('button', { name, exact: true })
        await button.click()
        expect(await button.getAttribute('aria-pressed')).toBe('true')
      }
      await compareOrRefreshGolden(
        join(process.cwd(), 'apps/web/tests/expected/usage-settings/dashboard.expected.md'),
        await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd),
        webSnapshotMode(),
      )
      const artifacts = join(process.cwd(), '.artifacts')
      await mkdir(artifacts, { recursive: true })
      const evidence = await mkdtemp(join(artifacts, 'usage-dashboard-'))
      await page.screenshot({ path: join(evidence, 'preview.png'), fullPage: true })
      const overflow = await dialog.evaluate(element => element.scrollWidth > element.clientWidth)
      expect(overflow).toBe(false)
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})
