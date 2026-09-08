/** Classification honors complete word phrases, deterministic precedence and explicit output limits. */
import { describe, expect, it } from 'vitest'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { catalogRevision, classifySkills, resolveCatalogSpec, shortDescription } from '../src/catalog.ts'
import { Context } from '@deepseek-ai/cordis'
import { Config, apply } from '../src/index.ts'

function skill(name: string, description = '', whenToUse?: string): SkillSummary {
  return { name, description, source: 'runtime', provider: 'fixture', invocation: { modelInvocable: true, userInvocable: true },
    ...whenToUse === undefined ? {} : { whenToUse } }
}

describe('skill catalog buckets', () => {
  it('preserves default categories through the actual Loader schema while allowing an explicit empty list', () => {
    expect(resolveCatalogSpec(Config({ pageSize: 1 })).buckets.map(bucket => bucket.name)).toEqual(['aws', 'mcp', 'reviews', 'security', 'other'])
    expect(resolveCatalogSpec(Config({ buckets: [] })).buckets.map(bucket => bucket.name)).toEqual(['other'])
  })
  it('assigns AWS, MCP, reviews and security once, keeping unmatched names discoverable', () => {
    const spec = resolveCatalogSpec({})
    const result = classifySkills([
      skill('aws-security', 'Review AWS account permissions'), skill('mcp-server', 'MCP integrations'),
      skill('code-review', 'Review changes'), skill('threat-hunt', 'Security analysis'),
      skill('draws', 'Drawing pictures'), skill('when-only', '', 'Use with Amazon Web Services'),
    ], spec)
    expect(result.map(({ bucket, skills }) => [bucket.name, skills.map(value => value.name)])).toEqual([
      ['aws', ['aws-security', 'when-only']], ['mcp', ['mcp-server']], ['reviews', ['code-review']],
      ['security', ['threat-hunt']], ['other', ['draws']],
    ])
  })

  it('matches normalized case-insensitive phrases and honors configurable order', () => {
    const spec = resolveCatalogSpec({ buckets: [
      { name: 'first', description: 'First group', keywords: ['Code REVIEW'] },
      { name: 'second', description: 'Second group', keywords: ['review'] },
    ] })
    const result = classifySkills([skill('code-review'), skill('preview'), skill('review-code')], spec)
    expect(result.find(group => group.bucket.name === 'first')?.skills.map(item => item.name)).toEqual(['code-review'])
    expect(result.find(group => group.bucket.name === 'second')?.skills.map(item => item.name)).toEqual(['review-code'])
    expect(result.find(group => group.bucket.name === 'other')?.skills.map(item => item.name)).toEqual(['preview'])
  })

  it('changes revision for membership, guidance and deployment configuration changes', () => {
    const spec = resolveCatalogSpec({})
    const initial = catalogRevision([skill('aws-one', 'First')], spec)
    expect(catalogRevision([skill('aws-two', 'First')], spec)).not.toBe(initial)
    expect(catalogRevision([skill('aws-one', 'Second')], spec)).not.toBe(initial)
    expect(catalogRevision([skill('aws-one', 'First', 'New guidance')], spec)).not.toBe(initial)
    expect(catalogRevision([skill('aws-one', 'First')], { ...spec, pageSize: 10 })).not.toBe(initial)
    expect(catalogRevision([skill('aws-one', 'First')], spec)).toBe(initial)
  })

  it('normalizes whitespace and reserves the ellipsis inside the summary bound', () => {
    expect(shortDescription('  one\n two\t three ', 9)).toBe('one tw...')
    expect(shortDescription('  one\n two ', 8)).toBe('one two')
  })

  it('rejects ambiguous category configuration and invalid output limits', () => {
    const bucket = { name: 'same', description: 'A category', keywords: ['word'] }
    for (const config of [
      { buckets: [bucket, bucket] }, { buckets: [{ ...bucket, name: 'other' }] },
      { buckets: [{ ...bucket, name: 'UPPER' }] }, { buckets: [{ ...bucket, keywords: [] }] },
      { buckets: [{ ...bucket, keywords: ['---'] }] }, { buckets: [{ ...bucket, description: ' ' }] },
      { pageSize: 0 }, { pageSize: 101 }, { pageSize: 1.5 }, { descriptionMaxLength: 2 }, { descriptionMaxLength: 2001 },
    ]) expect(() => resolveCatalogSpec(config)).toThrow('skill-catalog-buckets:')
    expect(resolveCatalogSpec({ buckets: [] }).buckets.map(item => item.name)).toEqual(['other'])
  })
})


it('rejects non-positive, fractional and unsafe byte limits at configuration resolution', () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => resolveCatalogSpec({ maxResponseBytes: limit })).toThrow('skill-catalog-buckets:')
    expect(() => resolveCatalogSpec({ maxCatalogBytes: limit })).toThrow('skill-catalog-buckets:')
  }
})

it('rejects excessive configured category names and counts before any skills are discovered', () => {
  expect(() => { apply(new Context(), { maxCatalogBytes: 1 }) }).toThrow('skill-catalog-buckets:')
  expect(() => { apply(new Context(), { buckets: [{ name: 'a'.repeat(9000), description: 'Short', keywords: ['aws'] }] }) })
    .toThrow('skill-catalog-buckets:')
  expect(() => { apply(new Context(), { buckets: Array.from({ length: 1000 }, (_, index) => ({
    name: `category-${index}`, description: 'Short', keywords: ['aws'],
  })) }) }).toThrow('skill-catalog-buckets:')
})
