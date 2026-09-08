import {
  defineSessionFormatMigration,
  snapshotSessionFormatArtifact,
} from '@deepseek-ai/dsh-session-format'
import { assertReleasedV2Header } from '@deepseek-ai/dsh-session-format-v1-to-v2'
import { assertReleasedV3Artifact, assertReleasedV3Header } from './validation.ts'

/**
 * Adjacent identity migration for v2 artifacts, including early skill-catalog
 * writers that emitted a v3 presentation digest under a v2 header. The exact
 * v3 target policy admits only that addition to the frozen v2 event semantics;
 * every event and reference remains unchanged.
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
    assertReleasedV2Header(source.header)
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
