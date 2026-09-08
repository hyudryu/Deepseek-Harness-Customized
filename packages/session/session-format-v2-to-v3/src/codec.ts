import {
  SessionFormatError,
  sessionFormatCount,
  snapshotSessionFormatArtifact,
  snapshotSessionFormatJson,
} from '@deepseek-ai/dsh-session-format'
import type {
  EncodedSessionFormatArtifact,
  SessionFormatArtifact,
  SessionFormatCodec,
  SessionFormatEvent,
  SessionFormatHeader,
  SessionFormatJsonObject,
  SessionFormatJsonValue,
} from '@deepseek-ai/dsh-session-format'
import { assertReleasedV3Header, assertReleasedV3PhysicalArtifact } from './validation.ts'

const HEADER_REQUIRED = ['type', 'version', 'id', 'createdAt', 'isSeeded', 'delegationDepth'] as const
const HEADER_OPTIONAL = ['cwd', 'parentSession', 'origin', 'agentPreset'] as const
/** Frozen physical JSON codec for released v3. */
export const releasedV3SessionFormatCodec = Object.freeze({
  version: 3,
  decodeHeader(value: unknown) {
    return decodePhysicalHeader(value)
  },
  decodeArtifact(headerValue: unknown, rowValues: readonly unknown[]) {
    return decodeArtifact(headerValue, rowValues, false)
  },
  decodeRecoverableArtifact(headerValue: unknown, rowValues: readonly unknown[]) {
    return decodeArtifact(headerValue, rowValues, true)
  },
  encodeArtifact(artifact: SessionFormatArtifact) {
    return encodeArtifact(artifact)
  },
} satisfies SessionFormatCodec & {
  encodeArtifact(artifact: SessionFormatArtifact): EncodedSessionFormatArtifact
})

function decodePhysicalHeader(value: unknown): SessionFormatHeader {
  const snapshot = snapshotSessionFormatJson(value, 'released v3 physical header')
  const record = jsonRecord(snapshot, 'released v3 physical header')
  exactKeys(record, HEADER_REQUIRED, HEADER_OPTIONAL, 'released v3 physical header')
  if (record['type'] !== 'session' || record['version'] !== 3) {
    throw new SessionFormatError('expected released v3 physical Session header')
  }
  if (typeof record['id'] !== 'string') throw new SessionFormatError('released v3 header id must be a string')
  const createdAt = sessionFormatCount(record['createdAt'], 'released v3 header createdAt')
  const delegationDepth = sessionFormatCount(record['delegationDepth'], 'released v3 header delegationDepth')
  if (typeof record['isSeeded'] !== 'boolean') throw new SessionFormatError('released v3 header isSeeded must be boolean')
  for (const key of ['cwd', 'parentSession', 'agentPreset'] as const) {
    if (record[key] !== undefined && typeof record[key] !== 'string') {
      throw new SessionFormatError(`released v3 header ${key} must be a string`)
    }
  }
  if (record['origin'] !== undefined && record['origin'] !== 'subagent') {
    throw new SessionFormatError('released v3 header origin must be "subagent"')
  }
  const header = snapshotSessionFormatJson({
    version: 3,
    id: record['id'],
    createdAt,
    ...(record['cwd'] === undefined ? {} : { cwd: record['cwd'] }),
    ...(record['parentSession'] === undefined ? {} : { parentSession: record['parentSession'] }),
    isSeeded: record['isSeeded'],
    ...(record['origin'] === undefined ? {} : { origin: record['origin'] }),
    delegationDepth,
    ...(record['agentPreset'] === undefined ? {} : { agentPreset: record['agentPreset'] }),
  }, 'released v3 logical header') as SessionFormatHeader
  assertReleasedV3Header(header)
  return header
}

function decodeArtifact(
  headerValue: unknown,
  rowValues: readonly unknown[],
  recoverable: boolean,
): SessionFormatArtifact {
  const header = decodePhysicalHeader(headerValue)
  const events: SessionFormatEvent[] = []
  let issue: SessionFormatError | undefined
  for (const [rowIndex, value] of rowValues.entries()) {
    let event: SessionFormatEvent
    try {
      event = decodeEvent(value, rowIndex)
    } catch (error: unknown) {
      const current = error instanceof SessionFormatError
        ? error
        : new SessionFormatError(`released v3 row ${rowIndex} is malformed`, { cause: error })
      if (!recoverable) throw current
      issue ??= current
      continue
    }
    if (issue !== undefined) {
      if (event.type === 'turn/end') throw issue
      continue
    }
    if (event.seq !== events.length) {
      const gap = new SessionFormatError(
        `released v3 row ${rowIndex} has seq gap (expected ${events.length}, got ${event.seq})`,
      )
      if (!recoverable) throw gap
      issue = gap
      if (event.type === 'turn/end') throw issue
      continue
    }
    events.push(event)
  }
  const inheritedEventCount = deriveInheritedEventCount(header, events)
  const artifact = snapshotSessionFormatArtifact({ header, inheritedEventCount, events }, 'released v3 artifact')
  assertReleasedV3PhysicalArtifact(artifact)
  return artifact
}

function decodeEvent(value: unknown, rowIndex: number): SessionFormatEvent {
  const snapshot = snapshotSessionFormatJson(value, `released v3 row ${rowIndex}`)
  const record = jsonRecord(snapshot, `released v3 row ${rowIndex}`)
  if (record['sourceEventSeqs'] === undefined) return record as unknown as SessionFormatEvent
  const seq = sessionFormatCount(record['seq'], `released v3 row ${rowIndex} seq`)
  return snapshotSessionFormatJson({
    ...record,
    sourceEventSeqs: decodeSeqRanges(record['sourceEventSeqs'], seq),
  }, `released v3 row ${rowIndex} provenance`) as SessionFormatEvent
}

function deriveInheritedEventCount(header: SessionFormatHeader, events: readonly SessionFormatEvent[]): number {
  let cut: number | undefined
  for (const event of events) {
    if (event.type !== 'session/end-seed') continue
    const data = jsonRecord(event.data, `session/end-seed ${event.seq} data`)
    if (data['inherited'] === true) cut = event.seq
  }
  if (header.isSeeded && cut === undefined) {
    throw new SessionFormatError('released v3 seeded Session lacks an inherited end-seed marker')
  }
  if (!header.isSeeded && cut !== undefined) {
    throw new SessionFormatError('released v3 unseeded Session contains an inherited end-seed marker')
  }
  return cut ?? 0
}

function encodeArtifact(artifact: SessionFormatArtifact): EncodedSessionFormatArtifact {
  assertReleasedV3PhysicalArtifact(artifact)
  const header = artifact.header
  const physicalHeader = snapshotSessionFormatJson({
    type: 'session',
    version: 3,
    id: header.id,
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    ...(header.parentSession === undefined ? {} : { parentSession: header.parentSession }),
    isSeeded: header.isSeeded,
    ...(header.origin === undefined ? {} : { origin: header.origin }),
    delegationDepth: header.delegationDepth,
    ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }),
  }, 'released v3 encoded header') as SessionFormatJsonObject
  const rows = Object.freeze(artifact.events.map(event => encodeProvenance(event)))
  return Object.freeze({ header: physicalHeader, rows })
}

function encodeProvenance(event: SessionFormatEvent): SessionFormatJsonObject {
  if (event.sourceEventSeqs === undefined) return event
  return snapshotSessionFormatJson({
    ...event,
    sourceEventSeqs: encodeSeqRanges(event.sourceEventSeqs as readonly number[]),
  }, `released v3 event ${event.seq} provenance`) as SessionFormatJsonObject
}

function decodeSeqRanges(value: SessionFormatJsonValue, maxEntries: number): readonly number[] {
  if (!Array.isArray(value)) throw new SessionFormatError('sourceEventSeqs must be an array')
  const output: number[] = []
  let hasRange = false
  for (const entry of value) {
    if (!Array.isArray(entry)) {
      output.push(sessionFormatCount(entry, 'sourceEventSeqs member'))
      continue
    }
    if (entry.length !== 2) throw new SessionFormatError('sourceEventSeqs range must be a [start, end] pair')
    const start = sessionFormatCount(entry[0], 'sourceEventSeqs range start')
    const end = sessionFormatCount(entry[1], 'sourceEventSeqs range end')
    if (start > end || end >= maxEntries || end - start + 1 > maxEntries - output.length) {
      throw new SessionFormatError('sourceEventSeqs range exceeds its event seq')
    }
    for (let current = start; current <= end; current += 1) output.push(current)
    hasRange = true
  }
  const seen = new Set<number>()
  for (const source of output) {
    if (source >= maxEntries || seen.has(source)) {
      throw new SessionFormatError('sourceEventSeqs ranges must contain unique earlier seqs')
    }
    seen.add(source)
  }
  if (hasRange && output.some((source, index) => index > 0 && source <= (output[index - 1] as number))) {
    throw new SessionFormatError('sourceEventSeqs ranges must be strictly increasing')
  }
  return output
}

function encodeSeqRanges(values: readonly number[]): readonly SessionFormatJsonValue[] {
  if (values.some((value, index) => index > 0 && value <= (values[index - 1] as number))) return [...values]
  const output: SessionFormatJsonValue[] = []
  for (let index = 0; index < values.length;) {
    const start = values[index] as number
    let end = start
    while (index + 1 < values.length && values[index + 1] === end + 1) {
      index += 1
      end += 1
    }
    output.push(end - start >= 2 ? [start, end] : start)
    if (end - start === 1) output.push(end)
    index += 1
  }
  return output
}

function jsonRecord(value: SessionFormatJsonValue | undefined, label: string): SessionFormatJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SessionFormatError(`${label} must be an object`)
  }
  return value as SessionFormatJsonObject
}

function exactKeys(
  record: SessionFormatJsonObject,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional])
  const missing = required.find(key => !Object.hasOwn(record, key))
  if (missing !== undefined) throw new SessionFormatError(`${label} lacks ${missing}`)
  const unexpected = Object.keys(record).find(key => !allowed.has(key))
  if (unexpected !== undefined) throw new SessionFormatError(`${label} has unexpected field ${unexpected}`)
}
