/** English documentation projection with optional legacy translation aliases. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DocsPage } from '../website/docs.ts'
import { rewriteMarkdown } from './project-doc-site.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-doc-site-english-'))
  roots.push(root)
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs/a.md'), '# A\n')
  const pages: DocsPage[] = (['root', 'en'] as const).map(locale => ({
    locale,
    contentLocale: 'en-US',
    source: 'docs/a.md',
    sourceAliases: ['docs/a.zh.md'],
    route: locale === 'root' ? 'a.md' : 'en/a.md',
    label: 'A',
    sidebar: null,
    section: 'Test',
    order: 0,
  }))
  return { locale: 'en' as const, sourcePath: 'docs/a.md', route: 'en/a.md', pages, repoRoot: root, repositoryRef: 'test' }
}

describe('optional legacy translation aliases', () => {
  it('projects a self-translation link without a translated file', () => {
    expect(rewriteMarkdown('[Translation](a.zh.md)\n', fixture()))
      .toBe('[Translation](../a.md)\n')
  })

  it('rejects an absent translation without a declared alias', () => {
    const options = fixture()
    for (const page of options.pages) delete page.sourceAliases
    expect(() => rewriteMarkdown('[Translation](a.zh.md)\n', options))
      .toThrow('links to missing path "a.zh.md"')
  })

  it('rejects unrelated missing documents and images', () => {
    const options = fixture()
    expect(() => rewriteMarkdown('[Missing](missing.md)\n', options))
      .toThrow('links to missing path "missing.md"')
    expect(() => rewriteMarkdown('![Image](a.zh.md)\n', options))
      .toThrow('links to missing path "a.zh.md"')
  })
})
