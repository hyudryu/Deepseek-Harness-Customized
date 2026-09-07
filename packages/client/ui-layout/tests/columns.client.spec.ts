import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN, clampWidth, computeColumns,
  DETAILS_DEFAULT, DETAILS_MIN, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT, SIDEBAR_MIN,
  BROWSER_MIN, BROWSER_DEFAULT,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

// Numeric preference form (0 = closed); helpers keep the scenario names readable.
const open = (width: number) => width
const closed = (_width: number) => 0

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(250.4, 240, 420)).toBe(250)
    expect(clampWidth(100, 240, 420)).toBe(240)
    expect(clampWidth(9999, 240, 420)).toBe(420)
  })
})

describe('computeColumns', () => {
  it('step 1: everything fits at preferred widths (browser closed)', () => {
    const cols = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), closed(0))
    expect(cols).toEqual({ sidebar: 280, center: 1920 - 280 - 360, details: 360, browser: 0 })
  })

  it('an open browser adds its column and the center absorbs the rest', () => {
    const cols = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), open(BROWSER_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 1920 - 280 - 360 - 480, details: 360, browser: 480 })
  })

  it('closed sidebar keeps its compact rail while closed details and browser contribute zero width', () => {
    expect(computeColumns(1920, closed(300), closed(360), closed(0)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1920 - SIDEBAR_COLLAPSED, details: 0, browser: 0 })
  })

  it('preferences beyond the clamp range are clamped before solving', () => {
    const cols = computeColumns(1920, open(9999), open(1), closed(0))
    expect(cols.sidebar).toBe(420)
    expect(cols.details).toBe(300)
    expect(computeColumns(1920, open(1), open(DETAILS_DEFAULT), closed(0)).sidebar).toBe(SIDEBAR_MIN)
  })

  it('the browser never exceeds its ceiling even when asked wider', () => {
    // browserMax caps at min(round(2000*0.5), 900) = 900; the center still clears its floor.
    const cols = computeColumns(2000, open(SIDEBAR_DEFAULT), closed(0), open(9000))
    expect(cols.browser).toBe(900)
    expect(cols.center).toBe(2000 - 280 - 900)
  })

  it('step 2: details shrinks first, center pinned at min', () => {
    // 280 + 360 + 640 = 1280 > 1250; details concedes to 1250-280-640 = 330.
    const cols = computeColumns(1250, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), closed(0))
    expect(cols).toEqual({ sidebar: 280, center: CENTER_MIN, details: 330, browser: 0 })
  })

  it('boundary: exactly at the step-1/step-2 seam', () => {
    const cols = computeColumns(300 + 360 + CENTER_MIN, open(300), open(360), closed(0))
    expect(cols).toEqual({ sidebar: 300, center: CENTER_MIN, details: 360, browser: 0 })
    const one = computeColumns(300 + 360 + CENTER_MIN - 1, open(300), open(360), closed(0))
    expect(one).toEqual({ sidebar: 300, center: CENTER_MIN, details: 359, browser: 0 })
  })

  it('step 3: details auto-closes when its min still starves center — sidebar holds its preference', () => {
    // 280 + 300 + 640 = 1220 > 1210 → details 0; sidebar untouched: center = 1210-280 = 930.
    const cols = computeColumns(1210, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), closed(0))
    expect(cols).toEqual({ sidebar: 280, center: 930, details: 0, browser: 0 })
  })

  it('browser concedes after details: shrinks, then auto-closes, to keep the center floor', () => {
    // 700 < 280 + 640 with an open browser at its default.
    const cols = computeColumns(700, open(SIDEBAR_DEFAULT), closed(0), open(BROWSER_DEFAULT))
    expect(cols).toEqual({ sidebar: 280, center: 700 - 280, details: 0, browser: 0 })
    // Room for the browser at its minimum: 280 + 640 + 320 = 1240.
    const fits = computeColumns(1240, open(SIDEBAR_DEFAULT), closed(0), open(BROWSER_DEFAULT))
    expect(fits).toEqual({ sidebar: 280, center: CENTER_MIN, details: 0, browser: BROWSER_MIN })
  })

  it('the sidebar never concedes: center absorbs the deficit below CENTER_MIN', () => {
    // 700 < 280+640: sidebar keeps 280, center takes 420 < CENTER_MIN.
    const cols = computeColumns(700, open(SIDEBAR_DEFAULT), closed(DETAILS_DEFAULT), closed(0))
    expect(cols).toEqual({ sidebar: SIDEBAR_DEFAULT, center: 420, details: 0, browser: 0 })
  })

  it('sidebar-closed narrow window: details concedes then auto-closes', () => {
    const fits = computeColumns(SIDEBAR_COLLAPSED + DETAILS_MIN + CENTER_MIN, closed(300), open(DETAILS_DEFAULT), closed(0))
    expect(fits).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: CENTER_MIN, details: DETAILS_MIN, browser: 0 })
    const starved = computeColumns(SIDEBAR_COLLAPSED + DETAILS_MIN + CENTER_MIN - 1, closed(300), open(DETAILS_DEFAULT), closed(0))
    expect(starved).toEqual({
      sidebar: SIDEBAR_COLLAPSED,
      center: DETAILS_MIN + CENTER_MIN - 1,
      details: 0,
      browser: 0,
    })
  })

  it('tiny viewport: details closes, sidebar holds, center takes the remainder', () => {
    const cols = computeColumns(400, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), closed(0))
    expect(cols.details).toBe(0)
    expect(cols.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(cols.center).toBe(Math.max(0, 400 - SIDEBAR_DEFAULT))
  })

  it('recovery is pure: re-widening restores preferred widths untouched', () => {
    const squeezed = computeColumns(1100, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), closed(0))
    expect(squeezed.details).toBe(0)
    const restored = computeColumns(1920, open(SIDEBAR_DEFAULT), open(DETAILS_DEFAULT), closed(0))
    expect(restored.details).toBe(DETAILS_DEFAULT)
    expect(restored.sidebar).toBe(SIDEBAR_DEFAULT)
  })
})

describe('computeColumns — degenerate viewports', () => {
  it('sidebar closed and viewport below CENTER_MIN: details auto-closes, center takes the rest', () => {
    // Reaches step 3's auto-close with the compact rail sidebar.
    expect(computeColumns(500, closed(300), open(DETAILS_DEFAULT), closed(0)))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 500 - SIDEBAR_COLLAPSED, details: 0, browser: 0 })
  })
})
