import { describe, expect, it, vi } from 'vitest'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'
import type { PanelActions } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'

function fakePanels(): PanelActions {
  return {
    setSidebar: vi.fn(),
    setDetails: vi.fn(),
    setBrowser: vi.fn(),
    toggleSidebar: vi.fn(),
    closeSidebar: vi.fn(),
    setNarrow: vi.fn(),
    setPhone: vi.fn(),
    revealBrowser: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
    openBrowser: vi.fn(),
    closeBrowser: vi.fn(),
  }
}

describe('LayoutController', () => {
  it('forwards the panel actions to the attached set', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.toggleSidebar()
    service.closeSidebar()
    service.openDetails()
    service.closeDetails()
    service.openBrowser()
    service.revealBrowser()
    service.closeBrowser()

    expect(panels.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(panels.closeSidebar).toHaveBeenCalledTimes(1)
    expect(panels.openDetails).toHaveBeenCalledTimes(1)
    expect(panels.closeDetails).toHaveBeenCalledTimes(1)
    expect(panels.openBrowser).toHaveBeenCalledTimes(1)
    expect(panels.revealBrowser).toHaveBeenCalledTimes(1)
    expect(panels.closeBrowser).toHaveBeenCalledTimes(1)
    expect(panels.setSidebar).not.toHaveBeenCalled()
    expect(panels.setDetails).not.toHaveBeenCalled()
    expect(panels.setBrowser).not.toHaveBeenCalled()
  })

  it('fails loud before the root entry wired its actions', () => {
    const service = new LayoutController()
    expect(() => { service.toggleSidebar() }).toThrow(/panel actions not wired/)
    expect(() => { service.openDetails() }).toThrow(/panel actions not wired/)
    expect(() => { service.closeDetails() }).toThrow(/panel actions not wired/)
  })

  it('re-attach overwrites the stale action set (entry re-register)', () => {
    const service = new LayoutController()
    const stale = fakePanels()
    const fresh = fakePanels()
    service.attachPanels(stale)
    service.attachPanels(fresh)

    service.toggleSidebar()

    expect(stale.toggleSidebar).not.toHaveBeenCalled()
    expect(fresh.toggleSidebar).toHaveBeenCalledTimes(1)
  })
})
