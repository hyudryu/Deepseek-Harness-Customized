/** Registration follows settings declaration lifetimes and plugin disposal. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { UsageSection } from '../src/client/UsageSection.tsx'
import { apply as hostApply } from '../src/index.ts'

it('registers the fifth tab when its owner appears and removes it on disposal', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const usage = { summary: vi.fn() }
  ctx.provide('remote', { usage })
  ctx.provide('remote.usage', usage)
  const slots = ctx.get('slots') as SlotRegistry
  const plugin = ctx.plugin({ inject: [...inject], apply })
  await plugin.await()
  const declare = () => slots.register({
    name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } },
  }, ({ renderSlot }: PropsRenderSlots<'settings.section'>) => renderSlot('settings.section', { close: vi.fn() }))
  let remove = declare()
  expect(slots.entries('settings.section')).toHaveLength(1)
  const entry = slots.entries('settings.section')[0]
  expect(entry?.options).toMatchObject({ id: 'usage', order: 40 })
  expect(entry?.component).toBe(UsageSection)
  expect(resolveSlotLabel(entry?.options.label)).toBe('Usage')
  locale.setLocale('zh')
  expect(resolveSlotLabel(entry?.options.label)).toBe('用量')
  remove()
  remove = declare()
  expect(slots.entries('settings.section')).toHaveLength(1)
  await plugin.dispose()
  expect(slots.entries('settings.section')).toHaveLength(0)
  remove()
})

it('keeps the Host entry inert', () => {
  expect(hostApply).not.toThrow()
})
