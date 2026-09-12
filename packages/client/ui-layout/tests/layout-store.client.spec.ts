// @vitest-environment jsdom
/**
 * createLayoutStore unit account: init shape, the action write set (clamp
 * inside actions), and the absence of browser persistence. Uses the
 * test-sanctioned path: factory self-call + .create() gives the
 * real engine instance (same create path as production).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createLayoutStore } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'
import {
  BROWSER_DEFAULT, BROWSER_MAX, BROWSER_MIN,
  DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'

const PERSIST_KEY = 'dsh.layout.panels'

beforeEach(() => { localStorage.clear() })

describe('createLayoutStore', () => {
  it('closing the phone overlay twice keeps it closed and preserves desktop width', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.setNarrow(true)
    actions.toggleSidebar()
    actions.closeSidebar()
    actions.closeSidebar()
    expect(store.getSnapshot()).toMatchObject({ sidebar: 400, narrowExpanded: false })
    actions.setNarrow(false)
    actions.closeSidebar()
    actions.closeSidebar()
    expect(store.getSnapshot().sidebar).toBe(0)
  })
  it('initializes the sidebar at its default width, details closed, wide viewport assumed', () => {
    const { store } = createLayoutStore().create()
    expect(store.getSnapshot()).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      browser: 0,
      narrow: false,
      narrowExpanded: false,
      phone: false,
      browserRevealed: false,
    })
  })

  it('each create() is an independent instance (factory is not a singleton)', () => {
    const a = createLayoutStore().create()
    const b = createLayoutStore().create()
    a.actions.setSidebar(400)
    expect(b.store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('setSidebar/setDetails clamp into the contract ranges', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(1)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MIN)
    actions.setSidebar(9999)
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_MAX)
    actions.setDetails(1)
    expect(store.getSnapshot().details).toBe(DETAILS_MIN)
    actions.setDetails(9999)
    expect(store.getSnapshot().details).toBe(DETAILS_MAX)
  })

  it('toggleSidebar flips closed <-> contract default (drag width forgotten)', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(0)
    actions.toggleSidebar()
    expect(store.getSnapshot().sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('narrow toggleSidebar flips only the re-expand override; the width preference survives', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setSidebar(400)
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot()).toEqual({
      sidebar: 400,
      details: 0,
      browser: 0,
      narrow: true,
      narrowExpanded: true,
      phone: false,
      browserRevealed: false,
    })
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(false)
    expect(store.getSnapshot().sidebar).toBe(400)
  })

  it('crossing the breakpoint drops the override; a same-value setNarrow keeps it', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setNarrow(true)
    actions.toggleSidebar()
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(true)
    actions.setNarrow(false)
    expect(store.getSnapshot()).toMatchObject({ narrow: false, narrowExpanded: false })
    actions.setNarrow(true)
    expect(store.getSnapshot().narrowExpanded).toBe(false)
  })

  it('openDetails uses the contract default, preserves an open width, and closeDetails zeroes', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(DETAILS_DEFAULT)
    actions.setDetails(500)
    actions.openDetails()
    expect(store.getSnapshot().details).toBe(500)
    actions.closeDetails()
    expect(store.getSnapshot().details).toBe(0)
  })

  it('does not persist panel geometry', () => {
    const first = createLayoutStore().create()
    first.actions.setSidebar(400)
    first.actions.openDetails()
    first.actions.setDetails(500)
    first.actions.openBrowser()
    first.actions.setBrowser(600)
    expect(localStorage.getItem(PERSIST_KEY)).toBeNull()

    const second = createLayoutStore().create()
    expect(second.store.getSnapshot()).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      browser: 0,
      narrow: false,
      narrowExpanded: false,
      phone: false,
      browserRevealed: false,
    })
  })

  it('reveals an agent-opened browser only off the phone layout, keeping an open width', () => {
    const { store, actions } = createLayoutStore().create()
    actions.setPhone(true)
    actions.setPhone(true)
    expect(store.getSnapshot().phone).toBe(true)
    actions.revealBrowser()
    expect(store.getSnapshot().browser).toBe(0)
    actions.setPhone(false)
    actions.revealBrowser()
    expect(store.getSnapshot().browser).toBe(BROWSER_DEFAULT)
    expect(store.getSnapshot().browserRevealed).toBe(true)
    // A reveal never rewrites the width of a column that is already open.
    actions.setBrowser(600)
    actions.revealBrowser()
    expect(store.getSnapshot().browser).toBe(600)
  })

  it('closes an automatically revealed column when the frame enters the phone layout', () => {
    const { store, actions } = createLayoutStore().create()
    actions.revealBrowser()
    expect(store.getSnapshot().browserRevealed).toBe(true)
    actions.setPhone(true)
    expect(store.getSnapshot()).toMatchObject({ phone: true, browser: 0, browserRevealed: false })
  })

  it('keeps a panel the user opened across the phone breakpoint', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openBrowser()
    expect(store.getSnapshot().browserRevealed).toBe(false)
    actions.setPhone(true)
    expect(store.getSnapshot().browser).toBe(BROWSER_DEFAULT)
    // An explicit close clears the automatic-reveal flag too.
    actions.revealBrowser()
    actions.closeBrowser()
    expect(store.getSnapshot()).toMatchObject({ browser: 0, browserRevealed: false })
  })

  it('clamps browser drag widths and preserves an open width until explicitly closed', () => {
    const { store, actions } = createLayoutStore().create()
    actions.openBrowser()
    expect(store.getSnapshot().browser).toBe(BROWSER_DEFAULT)
    actions.setBrowser(1)
    expect(store.getSnapshot().browser).toBe(BROWSER_MIN)
    actions.setBrowser(9999)
    expect(store.getSnapshot().browser).toBe(BROWSER_MAX)
    actions.openBrowser()
    expect(store.getSnapshot().browser).toBe(BROWSER_MAX)
    actions.closeBrowser()
    expect(store.getSnapshot().browser).toBe(0)
    actions.openBrowser()
    expect(store.getSnapshot().browser).toBe(BROWSER_DEFAULT)
  })
})
