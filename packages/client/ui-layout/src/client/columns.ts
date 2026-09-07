/**
 * Pure concession-chain column solver for the four-column AppFrame.
 * Chain order is fixed by contract: keep center >= CENTER_MIN by shrinking the
 * right-side panels — details first, then the browser — and auto-closing them
 * (derived zero width — preferred width preferences are never rewritten, so
 * widening the window restores them). The sidebar never concedes: its rendered
 * width is always the drag preference (or the collapsed rail), and center
 * absorbs any remaining deficit as the last resort. Inputs are the layout
 * store's plain width preferences (0 = closed); a closed sidebar resolves to
 * the fixed SIDEBAR_COLLAPSED control rail while closed details or browser
 * resolve to zero width. The browser cap is viewport-relative (50%) and is
 * applied here. The SIDEBAR_AUTO_COLLAPSE breakpoint is consumed by AppFrame,
 * which decides the effective sidebar preference before solving; the solver
 * itself stays breakpoint-free.
 */

/** Resolved widths for one frame; center may drop below CENTER_MIN only at the final fallback. */
export interface Columns { sidebar: number; center: number; details: number; browser: number }

// Contract-frozen geometry: the three-column concession chain's fixed points.
/** Center column floor; only the final fallback may go below it. */
export const CENTER_MIN = 640
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar rail: a 24px icon column between 16px horizontal paddings. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport width below which the sidebar auto-collapses to the rail (deepsuite
 * LG breakpoint); a manual toggle below it re-expands over the squeezed center
 * (stores.ts narrowExpanded). */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Details drag clamp floor. */
export const DETAILS_MIN = 300
/** Details drag clamp ceiling. */
export const DETAILS_MAX = 520
/** Details width before any user drag. */
export const DETAILS_DEFAULT = 360
/** Browser panel drag clamp floor. */
export const BROWSER_MIN = 320
/** Browser panel absolute drag clamp ceiling; the 50%-of-viewport cap still bounds it. */
export const BROWSER_MAX = 900
/** Browser panel width before any user drag. */
export const BROWSER_DEFAULT = 480

/**
 * Clamp a panel width into its contract range.
 * @param px - requested width.
 * @param min - range lower bound.
 * @param max - range upper bound.
 * @returns the clamped width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Solve the four column widths for one viewport frame. Pure: no hysteresis —
 * the output is a function of (viewport, preferences) only, so recovery on
 * re-widening is automatic. Preferences re-clamp here because they cross the
 * store boundary and callers may still supply stale ranges.
 * @param viewport - available frame width in px.
 * @param sidebar - sidebar width preference in px (0 = closed).
 * @param details - details width preference in px (0 = closed).
 * @param browser - browser panel width preference in px (0 = closed).
 * @returns resolved widths; details or browser 0 means visually closed (never unmounted), while a closed sidebar keeps its compact rail.
 */
export function computeColumns(viewport: number, sidebar: number, details: number, browser: number): Columns {
  // The sidebar is fixed at its preference (or the rail) — it never concedes.
  const s = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  // The browser panel expands up to the smaller of its absolute ceiling and
  // 50% of the viewport; that viewport-relative cap is applied here so a
  // resized frame can never exceed half the screen.
  const browserMax = Math.max(BROWSER_MIN, Math.min(Math.round(viewport * 0.5), BROWSER_MAX))
  let b = browser === 0 ? 0 : clampWidth(browser, BROWSER_MIN, browserMax)
  let d = details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX)

  // Across the right-side pair, details concedes before the browser.
  let center = viewport - s - b - d
  if (d > 0 && center < CENTER_MIN) {
    d = Math.max(DETAILS_MIN, viewport - s - b - CENTER_MIN)
    center = viewport - s - b - d
    if (center < CENTER_MIN) {
      d = 0
      center = viewport - s - b
    }
  }
  // The browser concedes last: down to its minimum, then auto-close if the
  // center floor is still starved — mirroring the details step.
  if (center < CENTER_MIN && b > 0) {
    const shrink = Math.max(0, Math.min(b - BROWSER_MIN, CENTER_MIN - center))
    b -= shrink
    center += shrink
    if (center < CENTER_MIN && b > 0) {
      center += b
      b = 0
    }
  }
  return { sidebar: s, center: Math.max(0, center), details: Math.max(0, d), browser: b }
}
