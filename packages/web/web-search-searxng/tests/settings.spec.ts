/** Settings changes select SearXNG without resolving DeepSeek credentials. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/index.ts'
/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}


afterEach(() => vi.restoreAllMocks())
describe('SearXNG live settings', () => {
  it.each([true, false])('takes precedence with fallback availability %s, then restores fallback on disable', async (fallbackAvailable) => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { preferredSearchProviders: ['searxng'], searchProvider: 'deepseek-official' })
    await ctx.plugin(MemorySettings)
    const fallback = vi.fn(async () => ({ sources: [], truncated: false }))
    ctx.web.registerSearchProvider({ id: 'deepseek-official', available: () => fallbackAvailable, search: fallback })
    const fiber = ctx.plugin(plugin, {})
    await fiber.await()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ results: [{ url: 'https://searx.test' }] })))
    await ctx.settings.update('web-search-searxng', { enabled: true })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [{ url: 'https://searx.test/' }] })
    expect(fallback).not.toHaveBeenCalled()
    await ctx.settings.update('web-search-searxng', { enabled: false })
    if (fallbackAvailable) {
      await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [] })
      expect(fallback).toHaveBeenCalledOnce()
    } else {
      await expect(ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
    }
    await fiber.dispose()
    expect(ctx.settings.describe().some(section => String(section.ns) === 'web-search-searxng')).toBe(false)
    await expect(ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
    await ctx.fiber.dispose()
  })
})


it('uses resolved defaults without a settings service and rejects disabled dispatch', async () => {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, { searchProvider: 'searxng' })
  plugin.apply(ctx, {})
  await expect(ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
  await ctx.fiber.dispose()
})

it('logs provider guidance only while enabled and web_search is visible, then removes it on disposal', async () => {
  const ctx = new Context()
  await ctx.plugin(WebRuntime)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = ctx.plugin(plugin, {})
  await fiber.await()
  const prompt = async () => renderPrompt(await ctx.systemPrompt.assemble())
  expect(await prompt()).not.toContain('SearXNG is enabled')
  await ctx.settings.update('web-search-searxng', { enabled: true })
  expect(await prompt()).not.toContain('SearXNG is enabled')
  const removeTool = ctx.tools.register(defineContentToolFixture({
    name: 'web_search', description: 'Search fixture', parameters: {},
    execute: async () => [],
  }))
  expect(await prompt()).toContain('SearXNG is enabled for web_search.')
  expect(await prompt()).toContain('without an API key')
  expect(await prompt()).toContain('without automatically retrying through DeepSeek')
  await ctx.settings.update('web-search-searxng', { enabled: false })
  expect(await prompt()).not.toContain('SearXNG is enabled')
  await ctx.settings.update('web-search-searxng', { enabled: true })
  await fiber.dispose()
  expect(await prompt()).not.toContain('SearXNG is enabled')
  removeTool()
  await ctx.fiber.dispose()
})
