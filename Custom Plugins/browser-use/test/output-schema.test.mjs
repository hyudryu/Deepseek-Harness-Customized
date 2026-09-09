import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

function registeredOutputSchema() {
  let registration
  const root = mkdtempSync(join(tmpdir(), 'dsh-bu-schema-'))
  const ctx = {
    logger: { warn() {}, debug() {} },
    effect(callback) { callback() },
    provide() {},
    skills: { register() {} },
    tools: { register(value) { registration = value } },
  }
  apply(ctx, { chromeEndpoint: '' }, {
    ensureRuntime: async () => '/stub/python',
    launchSidecar: async () => { throw new Error('not reached') },
  })
  rmSync(root, { recursive: true, force: true })
  return registration.output.schema
}

test('browser_use output schema uses object-level required arrays', () => {
  const schema = registeredOutputSchema()

  assert.deepEqual(schema.required, ['ok', 'action'])
  assert.equal(schema.properties.ok.required, undefined)
  assert.equal(schema.properties.action.required, undefined)

  const stepSchema = schema.properties.steps.items
  assert.deepEqual(stepSchema.required, ['step', 'action', 'result'])
  assert.equal(stepSchema.properties.step.required, undefined)
  assert.equal(stepSchema.properties.action.required, undefined)
  assert.equal(stepSchema.properties.result.required, undefined)
})

test('browser_use parameters cover run, screenshot, and stop', () => {
  let registration
  const root = mkdtempSync(join(tmpdir(), 'dsh-bu-params-'))
  const ctx = {
    logger: { warn() {}, debug() {} },
    effect(callback) { callback() },
    provide() {},
    skills: { register() {} },
    tools: { register(value) { registration = value } },
  }
  apply(ctx, { chromeEndpoint: '' }, {
    ensureRuntime: async () => '/stub/python',
    launchSidecar: async () => { throw new Error('not reached') },
  })
  rmSync(root, { recursive: true, force: true })
  const properties = registration.parameters.properties
  assert.deepEqual(properties.action.enum, ['run', 'screenshot', 'stop'])
  assert.deepEqual(registration.parameters.required, ['action'])
  for (const key of ['task', 'max_steps', 'use_vision', 'path', 'full_page']) {
    assert.ok(properties[key], `missing parameter ${key}`)
  }
  assert.equal(registration.parameters.additionalProperties, false)
})
