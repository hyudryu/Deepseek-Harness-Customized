import { describe, expect, it } from 'vitest'
import { isMaintainedMarkdownPath } from './repo-files.ts'

describe('maintained Markdown corpus', () => {
  it('includes English documents without consulting a counterpart or sidecar', () => {
    for (const path of ['README.md', 'docs/new-guide.md', 'packages/example/README.md']) {
      expect(isMaintainedMarkdownPath(path), path).toBe(true)
      expect(isMaintainedMarkdownPath(path.replaceAll('/', '\\')), path).toBe(true)
    }
  })

  it('excludes legacy translations and frozen notes from source API checks', () => {
    for (const path of [
      'README.zh.md',
      'docs/example.zh.md',
      'docs/example.i18n.yaml',
      '.agents/notes/archived/process/2026-09-07-example.md',
    ]) {
      expect(isMaintainedMarkdownPath(path), path).toBe(false)
      expect(isMaintainedMarkdownPath(path.replaceAll('/', '\\')), path).toBe(false)
    }
  })
})
