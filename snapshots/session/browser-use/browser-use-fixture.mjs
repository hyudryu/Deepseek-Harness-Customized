/** Deterministic executor fixture; mounts the real plugin through the shipped profile. */
import { apply as mount, inject } from '../../../Custom Plugins/browser-use/index.js'
export { inject }
export const name = 'browser-use-fixture'
export function apply(ctx) {
  mount(ctx, { chromeEndpoint: '' }, {
    ensureRuntime: async () => 'fixture-python',
    launchSidecar: async () => ({
      alive: true,
      async request(method) {
        if (method === 'run') return { done: true, final_result: 'Fixture page ready for inspection.', errors: [], steps: [], screenshot_path: 'evidence.png' }
        if (method === 'screenshot') return { screenshot_path: 'evidence.png', url: 'about:blank', title: 'Fixture page' }
        return { stopped: false }
      },
      async kill() { this.alive = false },
    }),
  })
}
