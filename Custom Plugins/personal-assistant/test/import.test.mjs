import assert from 'node:assert/strict'
import { test } from 'node:test'

test('the plugin entry imports with its installed runtime dependencies', async () => {
  const plugin = await import('../index.js')
  assert.equal(plugin.name, 'personal-assistant')
  assert.equal(typeof plugin.apply, 'function')
})
