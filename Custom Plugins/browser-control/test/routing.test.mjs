import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

test('registered browser guidance directs the model to the GUI session without endpoint discovery', async () => {
  let tool
  let skill
  const disposers = []
  apply({
    effect(callback) { disposers.push(callback()) },
    provide() {},
    skills: { register(value) { skill = value } },
    tools: { register(value) { tool = value } },
  })
  try {
    assert.match(tool.description, /DSH/)
    assert.match(tool.description, /session/i)
    assert.match(skill.content, /same tabs the user sees/)
    assert.match(skill.content, /Do not scan local ports/)
    assert.match(skill.content, /provider manages Chrome connectivity/)
    assert.doesNotMatch(skill.content, /localhost:9222|5914/)
    assert.match(skill.content, /when the user explicitly asks for Playwright/)
  } finally {
    for (const disposer of disposers.reverse()) await disposer?.()
  }
})
