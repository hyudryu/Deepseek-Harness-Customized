import { describe, expect, it } from 'vitest'
import { sessionFormatV2ToV3 } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import type { SessionFormatArtifact, SessionFormatEvent } from '@deepseek-ai/dsh-session-format'

const userMessage = {
  id: 'user-1',
  role: 'user',
  content: [{ type: 'text', text: 'question' }],
  source: { kind: 'user' },
} as const

const skillCatalogMessage = {
  id: 'catalog-1',
  role: 'user',
  content: [{ type: 'text', text: 'catalog' }],
  source: {
    kind: 'skill-catalog',
    form: 'catalog',
    entries: [{ name: 'skill', description: 'desc' }],
  },
} as const

function event(type: string, seq: number, time: number, data: SessionFormatEvent['data']): SessionFormatEvent {
  return { type, seq, time, data }
}

function artifact(events: readonly SessionFormatEvent[], header: SessionFormatArtifact['header'] = {
  version: 2,
  id: 'v2-source',
  createdAt: 1,
  isSeeded: false,
  delegationDepth: 0,
}): SessionFormatArtifact {
  return { header, inheritedEventCount: 0, events }
}

describe('sessionFormatV2ToV3', () => {
  it('re-releases the exact v2 header as v3 without reading events', () => {
    const header = {
      version: 2, id: 'header-only', createdAt: 1, isSeeded: false, delegationDepth: 0,
    }
    expect(sessionFormatV2ToV3.migrateHeader(header)).toStrictEqual({ ...header, version: 3 })
    expect(() => sessionFormatV2ToV3.migrateHeader({ ...header, version: 3 })).toThrow(/v2 header/)
  })

  it('migrates an identity artifact and validates the exact v3 target', () => {
    const source = artifact([
      event('turn/start', 0, 100, { turn: 1 }),
      { ...event('user/message', 1, 101, userMessage), surfaceOp: 'append' },
      event('turn/end', 2, 102, { turn: 1, reason: { kind: 'completed' } }),
    ])
    expect(sessionFormatV2ToV3.migrate(source)).toStrictEqual({
      header: { version: 3, id: 'v2-source', createdAt: 1, isSeeded: false, delegationDepth: 0 },
      inheritedEventCount: 0,
      events: source.events,
    })
  })

  it('migrates a released-v2 skill-catalog source and validates the v3 target', () => {
    const source = artifact([
      { ...event('user/message', 0, 100, skillCatalogMessage), surfaceOp: 'append' },
    ])
    const migrated = sessionFormatV2ToV3.migrate(source)
    expect(migrated.header.version).toBe(3)
    expect(migrated.events[0]?.data).toStrictEqual(skillCatalogMessage)
  })

  it('refuses a released-v2 log that emits a presentationDigest on a skill-catalog source', () => {
    const tagged = {
      ...skillCatalogMessage,
      source: { ...skillCatalogMessage.source, presentationDigest: 'abc123' },
    }
    const source = artifact([
      { ...event('user/message', 0, 100, tagged), surfaceOp: 'append' },
    ])
    expect(() => sessionFormatV2ToV3.migrate(source)).toThrow(/unexpected member/)
  })

  it('exposes an exact released-v3 target policy', () => {
    const target = sessionFormatV2ToV3.migrate(artifact([]))
    expect(() => sessionFormatV2ToV3.validateTarget(target)).not.toThrow()
    expect(() => sessionFormatV2ToV3.validateTargetHeader(target.header)).not.toThrow()
    expect(() => sessionFormatV2ToV3.validateTarget({
      header: { ...target.header, version: 2 },
      inheritedEventCount: 0,
      events: [],
    })).toThrow(/expected format v3 header/)
  })
})
