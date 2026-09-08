import { describe, expect, it } from 'vitest'
import { assertV3SnapshotCorpusPolicy } from './session-snapshot-corpus-policy.ts'

const completeV0 = {
  key: 'session/v0',
  selectedVersions: [0],
  retained: {
    version: 0,
    coverage: ['multi-hop', 'packed-row', 'retry-failure', 'shipped-profile'],
  },
} as const

const completeV1 = {
  key: 'session/v1',
  selectedVersions: [1],
  retained: { version: 1, coverage: ['adjacent-migration'] },
} as const

const completeV2 = {
  key: 'session/v2',
  selectedVersions: [2],
  retained: { version: 2, coverage: ['adjacent-migration'] },
} as const

describe('v3 recorded-session corpus policy', () => {
  it('accepts a current majority and the complete bounded v0/v1/v2 migration set', () => {
    expect(assertV3SnapshotCorpusPolicy([
      { key: 'session/current', selectedVersions: [3, 3, 3, 3, 3, 3, 3, 3] },
      {
        key: 'session/multi-hop',
        selectedVersions: [0, 0, 0],
        retained: { version: 0, coverage: ['multi-hop', 'shipped-profile'] },
      },
      {
        key: 'session/packed',
        selectedVersions: [0],
        retained: { version: 0, coverage: ['packed-row'] },
      },
      {
        key: 'session/retry',
        selectedVersions: [0],
        retained: { version: 0, coverage: ['retry-failure'] },
      },
      completeV1,
      completeV2,
    ])).toEqual({ currentRoles: 8, retainedRoles: 7, retainedScenarios: 5 })
  })

  it('requires v0 coverage from v0 fixtures and adjacent coverage from later predecessors', () => {
    expect(() => assertV3SnapshotCorpusPolicy([
      { key: 'session/current', selectedVersions: Array<number>(8).fill(3) },
      completeV1,
      completeV2,
    ])).toThrow('v3 Session corpus lacks v0 coverage')
  })

  it('does not let one retained generation claim another edge coverage', () => {
    expect(() => assertV3SnapshotCorpusPolicy([
      { key: 'session/current', selectedVersions: Array<number>(8).fill(3) },
      completeV0,
      {
        key: 'sdk/adjacent',
        selectedVersions: [1],
        retained: { version: 1, coverage: ['adjacent-migration', 'multi-hop'] },
      },
      completeV2,
    ])).toThrow('sdk/adjacent: v1 retained coverage must be adjacent-migration')
  })

  it('rejects an undeclared historical role and a retained current generation', () => {
    expect(() => assertV3SnapshotCorpusPolicy([
      { key: 'session/empty', selectedVersions: [] },
    ])).toThrow('session/empty: scenario owns no selected Session role')
    expect(() => assertV3SnapshotCorpusPolicy([
      { key: 'session/old', selectedVersions: [2] },
    ])).toThrow('session/old: selected Session generation v2 does not match expected v3')
    expect(() => assertV3SnapshotCorpusPolicy([
      {
        key: 'session/not-historical',
        selectedVersions: [3],
        retained: { version: 3, coverage: ['adjacent-migration'] },
      },
    ])).toThrow('session/not-historical: v3 corpus may retain only Session format v0, v1, or v2')
  })

  it('requires one direct fixture for each predecessor edge', () => {
    expect(() => assertV3SnapshotCorpusPolicy([
      { key: 'session/current', selectedVersions: Array<number>(8).fill(3) },
      completeV0,
      completeV2,
    ])).toThrow('v3 Session corpus lacks v1 coverage: adjacent-migration')
    expect(() => assertV3SnapshotCorpusPolicy([
      { key: 'session/current', selectedVersions: Array<number>(8).fill(3) },
      completeV0,
      completeV1,
    ])).toThrow('v3 Session corpus lacks v2 coverage: adjacent-migration')
  })

  it('bounds historical roles and requires the current generation to remain the majority', () => {
    const oversized = {
      ...completeV0,
      selectedVersions: Array<number>(11).fill(0),
    } as const
    expect(() => assertV3SnapshotCorpusPolicy([
      { key: 'session/current', selectedVersions: Array<number>(20).fill(3) },
      oversized,
      completeV1,
      completeV2,
    ])).toThrow('v3 Session corpus retains 13 historical roles; maximum is 10')
    expect(() => assertV3SnapshotCorpusPolicy([
      { key: 'session/current', selectedVersions: [3] },
      completeV0,
      completeV1,
      completeV2,
    ])).toThrow('v3 Session corpus requires a current majority; current=1, retained=3')
  })
})
