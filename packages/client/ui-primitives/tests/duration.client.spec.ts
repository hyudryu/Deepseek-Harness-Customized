import { describe, expect, it } from 'vitest'
import { rowDuration } from '../src/duration.ts'

describe('rowDuration', () => {
  it('reports a sub-minute span in seconds with one decimal', () => {
    expect(rowDuration(0)).toEqual({ unit: 'seconds', seconds: 0 })
    expect(rowDuration(999)).toEqual({ unit: 'seconds', seconds: 1 })
    expect(rowDuration(45_230)).toEqual({ unit: 'seconds', seconds: 45.2 })
  })

  it('clamps a negative span to zero', () => {
    expect(rowDuration(-1_500)).toEqual({ unit: 'seconds', seconds: 0 })
  })

  it('reports a minute and over as whole minutes plus two-digit seconds', () => {
    expect(rowDuration(125_000)).toEqual({ unit: 'minutes', minutes: 2, seconds: '05' })
    expect(rowDuration(162_000)).toEqual({ unit: 'minutes', minutes: 2, seconds: '42' })
    expect(rowDuration(3_600_000)).toEqual({ unit: 'minutes', minutes: 60, seconds: '00' })
  })

  it('rounds before the minute split so a sub-minute span never reads as sixty seconds', () => {
    expect(rowDuration(59_940)).toEqual({ unit: 'seconds', seconds: 59.9 })
    expect(rowDuration(59_960)).toEqual({ unit: 'minutes', minutes: 1, seconds: '00' })
  })
})
