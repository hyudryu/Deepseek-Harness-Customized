// @vitest-environment jsdom
/** Settings action registration follows desktop trust and plugin lifetime. */
import { cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
afterEach(cleanup)
it.each([true, false])('shows the pairing icon only on loopback (%s)', async (isLoopback) => {
  const runtime = await SlotTestRuntime.create()
  try {
    runtime.ctx.provide('remote', { $host: { isLoopback } } as never)
    const locale = new LocaleRuntime(runtime.ctx)
    locale.setLocale('en')
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.declare({ 'sidebar.settings.action': { kind: 'list', scope: 'root' } })
    const feature = await runtime.mount({ inject: [...inject], apply })
    const slot = runtime.renderSlot('sidebar.settings.action', { wide: true })
    expect(slot.view.queryByRole('button', { name: 'Mobile access' }) !== null).toBe(isLoopback)
    expect(runtime.slots.entries('sidebar.settings.action')).toHaveLength(isLoopback ? 1 : 0)
    await feature.dispose()
    expect(runtime.slots.entries('sidebar.settings.action')).toHaveLength(0)
    expect(slot.view.queryByRole('button', { name: 'Mobile access' })).toBeNull()
  } finally { await runtime.dispose() }
})
