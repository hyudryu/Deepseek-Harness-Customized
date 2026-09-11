// @vitest-environment jsdom
// Card view model: what a definition card can and cannot derive from the frozen
// call/result slice — plus the trailing duration label every Cordis row appends
// to its summary line.

import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { cordisActionCard, cordisDefineCard } from '../src/client/card-model.ts'
import { CordisActionRow, type CordisActionRowProps } from '../src/client/CordisActionRow.tsx'
import { CordisDefineRow, type CordisDefineRowProps } from '../src/client/CordisDefineRow.tsx'
import { CordisRunRow, type CordisRunRowProps } from '../src/client/CordisRunRow.tsx'
import type { CordisInventorySnapshot } from '../src/client/inventory.ts'
import { en } from '../src/client/locales.ts'

const ARGS = '{"name":"clock","purpose":"顶栏时钟","code":{"client":"return {}","host":"harness.handle(\'now\', () => Date.now())"}}'

// The rendered rows mount into document.body, which every render result's
// queries search: each test starts from an empty one.
afterEach(cleanup)

function running(over: Partial<RunningToolCall> = {}): RunningToolCall {
  return {
    callId: 'call-1', name: 'cordis_define', argsRaw: ARGS, turn: 1, step: 1, time: 1_000,
    subCalls: [], ...over,
  }
}

function settled(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 2, time: 2_000, callId: 'call-1',
    call: { name: 'cordis_define', argsRaw: ARGS }, callTime: 1_000,
    content: [{ type: 'text', text: 'defined dyn-1' }], isError: false,
    meta: { pluginId: 'dyn-1', packageId: 'pkg-1' }, subCalls: [], ...over,
  }
}

describe('cordisDefineCard', () => {
  it('reads name, purpose and both code halves off the call arguments', () => {
    const card = cordisDefineCard(running())
    expect(card).toMatchObject({
      name: 'clock', purpose: '顶栏时钟', clientCode: 'return {}', state: 'running', output: null,
    })
    expect(card.hostCode).toContain('harness.handle')
    // The host mints the id during define, so an unsettled call has none and the
    // card renders read-only.
    expect(card.pluginId).toBeNull()
    expect(card.packageId).toBeNull()
  })

  it('takes the minted id from the result presentation meta', () => {
    expect(cordisDefineCard(settled()).pluginId).toBe('dyn-1')
    expect(cordisDefineCard(settled()).packageId).toBe('pkg-1')
    expect(cordisDefineCard(settled()).output).toBe('defined dyn-1')
    expect(cordisDefineCard(settled()).state).toBe('ok')
  })

  it('renders read-only when the meta carries no usable id', () => {
    expect(cordisDefineCard(settled({ meta: undefined })).pluginId).toBeNull()
    expect(cordisDefineCard(settled({ meta: 'dyn-1' })).pluginId).toBeNull()
    expect(cordisDefineCard(settled({ meta: { pluginId: '' } })).pluginId).toBeNull()
    expect(cordisDefineCard(settled({ meta: { pluginId: 7 } })).pluginId).toBeNull()
  })

  it('classifies the define call’s own lifecycle and never operates a failed one', () => {
    const failed = cordisDefineCard(settled({
      isError: true, content: [{ type: 'text', text: 'SyntaxError: unexpected token\n  at line 3' }],
    }))
    expect(failed.state).toBe('error')
    expect(failed.errorSummary).toBe('SyntaxError: unexpected token')
    // A definition that failed to register has nothing to run.
    expect(failed.pluginId).toBeNull()

    expect(cordisDefineCard(settled({ isError: true, error: { name: 'E', code: 'interrupted' } })).state).toBe('stopped')
    expect(cordisDefineCard(settled({ content: [] })).output).toBeNull()
    expect(cordisDefineCard(settled({ content: [], error: { name: 'E', code: 'boom' } })).output).toBe('E: boom')
    // A non-text block has no display text of its own, so the row shows its JSON.
    expect(cordisDefineCard(settled({ content: [{ type: 'reasoning', text: 'weighing it' }] })).output)
      .toContain('"type": "reasoning"')
  })

  it('degrades on a truncated argument stream instead of dropping the row', () => {
    expect(cordisDefineCard(running({ argsRaw: '{"name":"clo' })).name).toBe('{"name":"clo')
    expect(cordisDefineCard(running({ argsRaw: '{"name":"clo' })).purpose).toBeNull()
    expect(cordisDefineCard(running({ argsRaw: '"just a string"' })).name).toBe('"just a string"')
  })

  it('keeps the raw first line as the name when the arguments carry none', () => {
    expect(cordisDefineCard(running({ argsRaw: '{"purpose":"顶栏时钟"}' })).name).toBe('{"purpose":"顶栏时钟"}')
    expect(cordisDefineCard(running({ argsRaw: '{"name":"","purpose":"顶栏时钟"}' })).name).toBe('{"name":"","purpose":"顶栏时钟"}')
  })

  it('reports an unknown name when the event window cut the call head', () => {
    // The host definition list answers identity and run state only, so the card
    // has no label left to fall back on and names its own call instead.
    const card = cordisDefineCard(settled({ call: null }))
    expect(card.name).toBeNull()
    expect(card.purpose).toBeNull()
  })
})

describe('cordisActionCard', () => {
  it('keeps the Plugin identity and lifecycle result for Stop and Remove cards', () => {
    const card = cordisActionCard(settled({
      call: { name: 'cordis_stop', argsRaw: '{"pluginId":"clock-1"}' },
      content: [{ type: 'text', text: 'Stopped clock-1.' }],
      meta: undefined,
    }))

    expect(card).toEqual({
      pluginId: 'clock-1',
      output: 'Stopped clock-1.',
      errorSummary: null,
      state: 'ok',
    })
  })
})

/** Any rendered duration label, including the `NaN` a missing call head would produce. */
const DURATION_TEXT = /NaN|\d+(?:\.\d+)?s|\d+m \d+s/

const RUN_ARGS = '{"pluginId":"dyn-1","packageId":"pkg-1","mode":"run"}'

function run(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 4, time: 2_000, callId: 'call-run',
    call: { name: 'cordis_run', argsRaw: RUN_ARGS }, callTime: 1_000,
    content: [{ type: 'text', text: 'Dynamic package pkg-1 is running' }], isError: false,
    meta: { pluginId: 'dyn-1', packageId: 'pkg-1', pluginRunId: 'run-1' }, subCalls: [], ...over,
  }
}

function stop(over: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 6, time: 2_000, callId: 'call-stop',
    call: { name: 'cordis_stop', argsRaw: '{"pluginId":"dyn-1"}' }, callTime: 1_000,
    content: [{ type: 'text', text: 'Stopped dyn-1.' }], isError: false, subCalls: [], ...over,
  }
}

/** The same settled fixture with `ms` between its call event and its result event. */
function spanning(block: ToolResultNode, ms: number): ToolResultNode {
  return { ...block, time: 1_000 + ms, callTime: 1_000 }
}

/**
 * This package's English dictionary with `{name}` interpolation: the seat the
 * renderer binds for the `cordis` namespace.
 */
function cordisTranslate(): CordisDefineRowProps['t'] {
  return (key, params) => {
    const template = (en as Record<string, string>)[key] ?? key
    const values = params ?? {}
    return template.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match)
  }
}

const t = cordisTranslate()

/** Live facts the rows read for their status readout; the duration is not one of them. */
const inventory: CordisInventorySnapshot = { rows: [], removed: new Set(), read: true }
const liveFaces = {
  useInventory: (select: (snapshot: CordisInventorySnapshot) => unknown) => select(inventory),
  useLoaded: (select: (loaded: readonly unknown[]) => unknown) => select([]),
  useRunCards: (select: (cards: ReadonlyMap<string, unknown>) => unknown) => select(new Map()),
  useActiveRuns: (select: (runs: ReadonlyMap<string, unknown>) => unknown) => select(new Map()),
  onObserveRunCard: (): void => {},
  renderSlot: (): null => null,
}

function defineProps(block: CordisDefineRowProps['block']): CordisDefineRowProps {
  return { callId: block.callId, toolName: 'cordis_define', block, t, ...liveFaces } as unknown as CordisDefineRowProps
}

function runProps(block: CordisRunRowProps['block']): CordisRunRowProps {
  return { callId: block.callId, toolName: 'cordis_run', block, t, ...liveFaces } as unknown as CordisRunRowProps
}

function stopProps(block: CordisActionRowProps['block']): CordisActionRowProps {
  return { callId: block.callId, toolName: 'cordis_stop', block, t, ...liveFaces } as unknown as CordisActionRowProps
}

describe('Cordis row duration labels', () => {
  // createElement rather than JSX: this package's row coverage lives in a .ts
  // spec, and the rows are rendered here as plain component calls.
  it('labels a settled call in every Cordis row with the span it took', () => {
    const define = render(createElement(CordisDefineRow, defineProps(spanning(settled(), 45_230))))
    expect(define.getByText('45.2s')).toBeTruthy()
    define.unmount()

    const runRow = render(createElement(CordisRunRow, runProps(spanning(run(), 162_000))))
    expect(runRow.getByText('2m 42s')).toBeTruthy()
    runRow.unmount()

    const action = render(createElement(CordisActionRow, stopProps(spanning(stop(), 45_230))))
    expect(action.getByText('45.2s')).toBeTruthy()
  })

  it('renders no label while the call runs or its call head fell outside the window', () => {
    const inFlight = render(createElement(CordisDefineRow, defineProps(running())))
    expect(inFlight.queryByText(DURATION_TEXT)).toBeNull()
    expect(inFlight.getByText('顶栏时钟')).toBeTruthy()
    inFlight.unmount()

    const truncated = render(createElement(CordisRunRow, runProps({ ...run(), callTime: null })))
    expect(truncated.queryByText(DURATION_TEXT)).toBeNull()
    truncated.unmount()

    const action = render(createElement(CordisActionRow, stopProps({ ...stop(), callTime: null })))
    expect(action.queryByText(DURATION_TEXT)).toBeNull()
    expect(action.getByText('dyn-1')).toBeTruthy()
  })
})
