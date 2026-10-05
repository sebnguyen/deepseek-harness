/**
 * Tests for the `sandbox-policy/resolve` narrow-only waterfall: narrowing
 * listeners clamp `resolveClamped`, widening returns are capped back to the
 * standing mode, and the model-facing `sandbox:policy` context renders the
 * standing policy so prompt bytes stay identical across clamps.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'

async function mounted(mode: 'read-only' | 'workspace-write' | 'danger-full-access'): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SandboxPolicyService, { mode })
  return ctx
}

function session(id: string): Session {
  const sessionId = SessionId(id)
  return Session.create(sessionId, undefined, {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: 0,
    isSeeded: false,
  })
}

function agentFor(activeSession: Session): Agent {
  return { session: activeSession } as unknown as Agent
}

describe('sandbox-policy/resolve narrow-only waterfall', () => {
  it('clamps a narrowing listener and caps a widening one', async () => {
    const ctx = await mounted('workspace-write')
    const s = session('clamp')
    ctx.on('sandbox-policy/resolve', async (policy, _session, next) => {
      await next()
      return { ...policy, mode: 'read-only' }
    })
    expect((await ctx.sandboxPolicy.resolveClamped({ session: s })).mode).toBe('read-only')
  })

  it('caps a widening listener back to the standing mode', async () => {
    const ctx = await mounted('read-only')
    const s = session('widen')
    ctx.on('sandbox-policy/resolve', async (policy, _session, next) => {
      await next()
      return { ...policy, mode: 'danger-full-access' }
    })
    const clamped = await ctx.sandboxPolicy.resolveClamped({ session: s })
    expect(clamped.mode).toBe('read-only')
  })

  it('keeps the standing policy and prompt context identical across a clamp', async () => {
    const ctx = await mounted('workspace-write')
    const s = session('silent')
    ctx.on('sandbox-policy/resolve', async (policy, _session, next) => {
      await next()
      return { ...policy, mode: 'read-only' }
    })
    const before = (await ctx.systemPrompt.assemble({ agent: agentFor(s) }))
      .contexts.find(context => context.name === 'sandbox:policy')?.text
    await ctx.sandboxPolicy.resolveClamped({ session: s })
    const after = (await ctx.systemPrompt.assemble({ agent: agentFor(s) }))
      .contexts.find(context => context.name === 'sandbox:policy')?.text
    expect(before).toBe(after)
    expect(before).toContain('workspace-write')
  })

  it('resolves the standing policy untouched without listeners or session', async () => {
    const ctx = await mounted('workspace-write')
    expect((await ctx.sandboxPolicy.resolveClamped()).mode).toBe('workspace-write')
    expect((await ctx.sandboxPolicy.resolveClamped({ session: session('none') })).mode).toBe('workspace-write')
  })
})
