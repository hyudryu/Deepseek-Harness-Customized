// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SuperGoal } from '@deepseek-ai/dsh-super-goal/client'
import { SuperGoalBanner } from '../src/client/SuperGoalBanner.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function props(goal: SuperGoal | null | undefined, superGoalArmed = true, running = true) {
  return {
    useProjection: vi.fn(() => goal),
    useSession: vi.fn((select: (snapshot: { running: boolean; superGoalArmed: boolean }) => unknown) =>
      select({ running, superGoalArmed })),
    t: makeTranslate(en),
  } as unknown as Parameters<typeof SuperGoalBanner>[0]
}

const goal: SuperGoal = { revision: 1, objective: 'Ship the working product', phase: 'active' }

describe('SuperGoal session banner', () => {
  it.each([null, undefined])('hides the banner without a goal (%s)', (value) => {
    expect(render(<SuperGoalBanner {...props(value)} />).container.firstChild).toBeNull()
  })

  it.each([
    ['active', en['status.active']],
    ['paused', en['status.paused']],
    ['blocked', en['status.blocked']],
    ['complete', en['status.complete']],
  ] as const)('keeps the objective visible in %s state', (phase, status) => {
    render(<SuperGoalBanner {...props({ ...goal, phase })} />)
    expect(screen.getByRole('region', { name: 'SuperGoal' })).toBeTruthy()
    expect(screen.getByText(goal.objective)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe(status)
  })

  it('shows the blocker reason and clears it when work resumes', () => {
    const view = render(<SuperGoalBanner {...props({ ...goal, phase: 'blocked', reason: 'Choose a deployment account' })} />)
    expect(screen.getByText('Choose a deployment account')).toBeTruthy()
    view.rerender(<SuperGoalBanner {...props(goal)} />)
    expect(screen.queryByText('Choose a deployment account')).toBeNull()
  })

  it('does not promise continuation when ordinary work runs with a saved active goal', () => {
    render(<SuperGoalBanner {...props(goal, false, true)} />)
    expect(screen.getByRole('status').textContent).toBe(en['status.ready'])
    expect(screen.queryByText(/continuing until/i)).toBeNull()
  })

  it('shows resume guidance for a saved or cancelled active goal', () => {
    render(<SuperGoalBanner {...props(goal, false)} />)
    expect(screen.getByRole('status').textContent).toBe(en['status.ready'])
  })
})
