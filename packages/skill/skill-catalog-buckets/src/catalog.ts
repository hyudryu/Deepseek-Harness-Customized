/** Deterministic skill classification and bounded discovery pages. */
import { createHash } from 'node:crypto'
import { isSkillName, type SkillSummary } from '@deepseek-ai/dsh-skill'
import type { Bucket, Config } from './index.ts'

/** Validated settings used identically by prompt publication and discovery. */
export interface CatalogSpec {
  buckets: readonly Bucket[]
  pageSize: number
  descriptionMaxLength: number
}

/** One category paired with all its current model-invocable skills. */
export interface BucketMembers {
  bucket: Bucket
  skills: SkillSummary[]
}

/** Default routing categories used by both Loader configuration and direct construction. */
export const DEFAULT_BUCKETS: Bucket[] = [
  { name: 'aws', description: 'AWS accounts, cloud infrastructure, deployment and operations.', keywords: ['aws', 'amazon web services', 'cloudformation', 'bedrock'] },
  { name: 'mcp', description: 'MCP servers, tools, connectors and integrations.', keywords: ['mcp', 'model context protocol'] },
  { name: 'reviews', description: 'Code review, pull requests and review feedback.', keywords: ['review', 'reviews', 'reviewing', 'pull request'] },
  { name: 'security', description: 'Security assessment, incident investigation and defensive operations.', keywords: ['security', 'penetration', 'malware', 'threat', 'vulnerability', 'vulnerabilities', 'forensics', 'phishing', 'ransomware', 'privesc', 'active directory'] },
]
const other: Bucket = { name: 'other', description: 'Skills outside the configured categories.', keywords: [] }

function words(value: string): string {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ')
}

/**
 * Resolve omitted configuration and reject ambiguous categories or invalid limits.
 * @param config - deployment configuration.
 * @returns complete category and pagination settings.
 */
export function resolveCatalogSpec(config: Config): CatalogSpec {
  const buckets = config.buckets ?? DEFAULT_BUCKETS
  const names = new Set<string>()
  for (const bucket of buckets) {
    if (!isSkillName(bucket.name) || bucket.name === 'other' || names.has(bucket.name)) {
      throw new Error('skill-catalog-buckets: category names must be unique kebab-case names; other is reserved')
    }
    if (!bucket.description.trim() || bucket.keywords.length === 0 || bucket.keywords.some(keyword => !words(keyword))) {
      throw new Error('skill-catalog-buckets: each category needs a description and nonempty keyword phrases')
    }
    names.add(bucket.name)
  }
  const pageSize = config.pageSize ?? 20
  const descriptionMaxLength = config.descriptionMaxLength ?? 160
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('skill-catalog-buckets: pageSize must be an integer from 1 to 100')
  }
  if (!Number.isInteger(descriptionMaxLength) || descriptionMaxLength < 3 || descriptionMaxLength > 2000) {
    throw new Error('skill-catalog-buckets: descriptionMaxLength must be an integer from 3 to 2000')
  }
  return { buckets: [...buckets.map(bucket => ({ ...bucket, keywords: [...bucket.keywords] })), other], pageSize, descriptionMaxLength }
}

/**
 * Normalize and bound one model-visible summary.
 * @param value - original description.
 * @param maximum - maximum characters including ellipsis.
 * @returns single-line bounded text.
 */
export function shortDescription(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maximum ? normalized : normalized.slice(0, maximum - 3) + '...'
}

/**
 * Assign every skill to exactly one category, preserving stable name order within it.
 * @param skills - complete visible registry metadata.
 * @param spec - resolved classification configuration.
 * @returns categories paired with their current members, including empty categories.
 */
export function classifySkills(skills: readonly SkillSummary[], spec: CatalogSpec): BucketMembers[] {
  const result = spec.buckets.filter(bucket => bucket.name !== 'other').map(bucket => ({ bucket, skills: [] as SkillSummary[] }))
  const fallback: BucketMembers = { bucket: other, skills: [] }
  for (const skill of [...skills].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const text = ` ${words([skill.name, skill.description, skill.whenToUse ?? ''].join(' '))} `
    const selected = result.find(group => group.bucket.keywords.some(keyword => text.includes(` ${words(keyword)} `))) ?? fallback
    selected.skills.push(skill)
  }
  return [...result, fallback]
}

/**
 * Identify membership and configuration changes that category counts cannot reveal.
 * @param skills - current complete model-invocable metadata.
 * @param spec - resolved configuration.
 * @returns stable SHA-256 revision.
 */
export function catalogRevision(skills: readonly SkillSummary[], spec: CatalogSpec): string {
  return createHash('sha256').update(JSON.stringify({ spec, skills: skills.map(skill => [skill.name, skill.description, skill.whenToUse]) })).digest('hex')
}
