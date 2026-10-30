import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { createTarget, type WorkspaceOwner } from '../src/client/contract.ts'

describe('Turbo session target policy', () => {
  it('prefers an explicit Workspace, then the Workspace owning the source Session', () => {
    const workspace: WorkspaceOwner = {
      workspaceId: 'w1' as WorkspaceId,
      sessionIds: ['s1' as SessionId],
    }
    expect(createTarget([workspace], { workspaceId: 'w2' as WorkspaceId })).toEqual({ workspaceId: 'w2' })
    expect(createTarget([workspace], { sourceSessionId: 's1' as SessionId, cwd: '/work/a' })).toEqual({ workspaceId: 'w1' })
  })

  it('falls back to the source directory when no Workspace owns the Session', () => {
    expect(createTarget([], { sourceSessionId: 's1' as SessionId, cwd: '/work/a' })).toEqual({ cwd: '/work/a' })
    expect(createTarget([], { sourceSessionId: 's1' as SessionId })).toBeUndefined()
    expect(createTarget([], undefined)).toBeUndefined()
  })

  it('falls back to the sidebar default Workspace when the target names none', () => {
    expect(createTarget([], undefined, 'w3' as WorkspaceId)).toEqual({ workspaceId: 'w3' })
    expect(createTarget([], {}, 'w3' as WorkspaceId)).toEqual({ workspaceId: 'w3' })
    expect(createTarget([], undefined)).toBeUndefined()
  })

  it('keeps explicit, source-owned, and directory targets ahead of the default', () => {
    const workspace: WorkspaceOwner = {
      workspaceId: 'w1' as WorkspaceId,
      sessionIds: ['s1' as SessionId],
    }
    const fallback = 'w3' as WorkspaceId
    expect(createTarget([workspace], { workspaceId: 'w2' as WorkspaceId }, fallback)).toEqual({ workspaceId: 'w2' })
    expect(createTarget([workspace], { sourceSessionId: 's1' as SessionId }, fallback)).toEqual({ workspaceId: 'w1' })
    expect(createTarget([], { sourceSessionId: 's1' as SessionId, cwd: '/work/a' }, fallback)).toEqual({ cwd: '/work/a' })
  })
})
