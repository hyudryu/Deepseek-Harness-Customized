import {
  defineSessionFormatMigration,
  snapshotSessionFormatArtifact,
} from '@deepseek-ai/dsh-session-format'
import { assertReleasedV2Artifact, assertReleasedV2Header } from '@deepseek-ai/dsh-session-format-v1-to-v2'
import { assertReleasedV3Artifact, assertReleasedV3Header } from './validation.ts'

/**
 * Adjacent migration that rereleases the exact v2 artifact as v3. The writer
 * bump is needed because released v3 admits an optional `presentationDigest`
 * identity on the durable `skill-catalog` message source; the frozen v2 source
 * validator rejects that member, so a valid v3 log must be tagged v3 to be
 * read through the permissive v3 source semantics.
 */
export const sessionFormatV2ToV3 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v2-to-v3',
  fromVersion: 2,
  toVersion: 3,
  migrateHeader(header) {
    assertReleasedV2Header(header)
    return { ...header, version: 3 }
  },
  migrate(source) {
    assertReleasedV2Artifact(source)
    const target = snapshotSessionFormatArtifact({
      header: { ...source.header, version: 3 },
      inheritedEventCount: source.inheritedEventCount,
      events: source.events,
    }, 'released v2-to-v3 target')
    assertReleasedV3Artifact(target)
    return target
  },
  validateTarget: assertReleasedV3Artifact,
  validateTargetHeader: assertReleasedV3Header,
})
