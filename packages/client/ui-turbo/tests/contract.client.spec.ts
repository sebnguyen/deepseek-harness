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
})
