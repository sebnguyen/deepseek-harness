import { describe, expect, it } from 'vitest'
import {
  extendArchiveManifest,
  parseArchiveManifest,
  renderArchiveManifest,
  validateArchiveArtifacts,
  validateArchiveManifestExtension,
  type ArchiveManifest,
} from './archived-agent-notes.ts'
import { isArchivedAgentNotePath } from './repo-files.ts'

function fixture(): Map<string, Buffer> {
  const base = '2026-07-26-example'
  const source = Buffer.from('# Agent Note: Example\n\nStatus: implemented\nArchived: 2026-07-26\n\n## Problem\n\nExample.\n')
  return new Map([[`process/${base}.md`, source]])
}

describe('archived Agent Notes', () => {
  it('recognizes archived paths with POSIX and Windows separators', () => {
    expect(isArchivedAgentNotePath('.agents/notes/archived/process/example.md')).toBe(true)
    expect(isArchivedAgentNotePath('.agents\\notes\\archived\\process\\example.md')).toBe(true)
    expect(isArchivedAgentNotePath('.agents/notes/implemented/process/example.md')).toBe(false)
  })

  it('accepts one sealed English note with valid archive metadata', () => {
    expect(validateArchiveArtifacts(fixture())).toEqual([])
  })

  it('rejects non-English artifact shapes in the archive', () => {
    const artifacts = fixture()
    artifacts.set('process/2026-07-26-example.zh.md', Buffer.from('zh'))
    artifacts.set('process/2026-07-26-example.i18n.yaml', Buffer.from('meta'))
    const joined = validateArchiveArtifacts(artifacts).join('\n')
    expect(joined).toMatch(/process\/2026-07-26-example\.zh\.md: expected \{kind\}\/yyyy-mm-dd-topic\.md/)
    expect(joined).toMatch(/process\/2026-07-26-example\.i18n\.yaml: expected \{kind\}\/yyyy-mm-dd-topic\.md/)
  })

  it('rejects invalid archive headers', () => {
    const artifacts = fixture()
    artifacts.set(
      'process/2026-07-26-example.md',
      Buffer.from('# Agent Note: Example\n\nStatus: proposed\nArchived: yesterday\n'),
    )
    const joined = validateArchiveArtifacts(artifacts).join('\n')
    expect(joined).toMatch(/line 3 must be `Status: implemented`/)
    expect(joined).toMatch(/line 4 must be `Archived: YYYY-MM-DD`/)
  })

  it('extends the manifest, carries surviving seals, and drops pruned ones', () => {
    const artifacts = fixture()
    const empty: ArchiveManifest = { version: 1, files: {} }
    const first = extendArchiveManifest(empty, artifacts)
    expect(first.errors).toEqual([])
    expect(first.added).toHaveLength(1)

    const sealed: ArchiveManifest = { version: 1, files: first.files }
    const changed = new Map(artifacts)
    changed.set('process/2026-07-26-example.md', Buffer.from('changed'))
    expect(extendArchiveManifest(sealed, changed).errors).toEqual([
      'process/2026-07-26-example.md: sealed content hash changed',
    ])
    const pruned = extendArchiveManifest(sealed, new Map())
    expect(pruned.errors).toEqual([])
    expect(pruned.added).toEqual([])
    expect(pruned.files).toEqual({})
  })

  it('rejects changed seal hashes but permits repository-wide prunes in the extension check', () => {
    const artifacts = fixture()
    const initial = extendArchiveManifest({ version: 1, files: {} }, artifacts)
    const baseline: ArchiveManifest = { version: 1, files: initial.files }
    const path = 'process/2026-07-26-example.md'
    const changedArtifacts = new Map(artifacts)
    changedArtifacts.set(path, Buffer.from('changed'))
    const replacement = extendArchiveManifest({ version: 1, files: {} }, changedArtifacts)
    const current: ArchiveManifest = { version: 1, files: replacement.files }

    expect(validateArchiveManifestExtension(baseline, current)).toEqual([
      `${path}: sealed manifest hash changed`,
    ])
    expect(validateArchiveManifestExtension(baseline, { version: 1, files: {} })).toEqual([])
  })

  it('round-trips the deterministic manifest schema', () => {
    const content = renderArchiveManifest({ 'process/z.md': `sha256:${'a'.repeat(64)}` })
    expect(parseArchiveManifest(content)).toEqual({
      version: 1,
      files: { 'process/z.md': `sha256:${'a'.repeat(64)}` },
    })
  })
})
