/**
 * Focused coverage for decision-model skill admission: the planner holds
 * whenever the judgment would be unsound, admits only skills above the
 * threshold that the window does not already hold, caps the admission, and
 * emits one `skill-invocation` injection per admitted skill.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SkillCatalogSnapshot, SkillDefinition, SkillSummary } from '@deepseek-ai/dsh-skill'
import * as skillContext from '../src/index.ts'
import type { Config, AdmissionInput } from '../src/index.ts'
import type { DecisionRequest, NoulAnswer } from '../src/decision.ts'
import { liveSkillNames } from '../src/live-set.ts'

const signal = new AbortController().signal

/** A model-invocable summary for one fixture skill. */
function summary(name: string): SkillSummary {
  return {
    name,
    description: `${name} description`,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'runtime',
    provider: 'test',
  }
}

/** A loadable definition for one fixture skill. */
function definition(name: string): Pick<SkillDefinition, 'name' | 'provider' | 'resourceBase' | 'content'> {
  return { name, provider: 'test', content: `Body of ${name}.` }
}

function snapshot(names: readonly string[], complete = true): SkillCatalogSnapshot {
  return { skills: names.map(summary), complete }
}

/** An evaluator answering every question with the same probability. */
function evaluator(probability: number) {
  return async (request: DecisionRequest): Promise<readonly NoulAnswer[]> =>
    request.questions.map(() => ({ kind: 'noul', probability }) as const)
}

/** Resolved configuration for one test, built explicitly rather than spread. */
function configured(overrides: Partial<Config> = {}): Config {
  return {
    enabled: overrides.enabled ?? true,
    provider: overrides.provider ?? 'typesafe',
    threshold: overrides.threshold ?? 0.5,
    topK: overrides.topK ?? 3,
    model: overrides.model ?? 'jev-1.13.0',
    endpoint: overrides.endpoint ?? 'https://api.typesafe.ai/v1/systemone',
    timeoutMs: overrides.timeoutMs ?? 10_000,
  }
}

function input(overrides: Partial<AdmissionInput> = {}): AdmissionInput {
  return {
    snapshot: snapshot(['dsh-doc']),
    live: new Set<string>(),
    evaluate: evaluator(0.9),
    state: { turn: 1, step: 1 },
    signal,
    ...overrides,
  }
}

describe('planAdmission', () => {
  it('holds when the plugin is disabled', async () => {
    const plan = await skillContext.planAdmission(input(), configured({ enabled: false }))
    expect(plan).toEqual({ kind: 'hold', reason: 'disabled' })
  })

  it('holds on an incomplete catalog observation', async () => {
    const plan = await skillContext.planAdmission(
      input({ snapshot: snapshot(['dsh-doc'], false) }),
      configured(),
    )
    expect(plan).toEqual({ kind: 'hold', reason: 'incomplete' })
  })

  it('holds when no evaluator is registered', async () => {
    const plan = await skillContext.planAdmission(input({ evaluate: undefined }), configured())
    expect(plan).toEqual({ kind: 'hold', reason: 'evaluator-unavailable' })
  })

  it('holds when every candidate is already live', async () => {
    const plan = await skillContext.planAdmission(input({ live: new Set(['dsh-doc']) }), configured())
    expect(plan).toEqual({ kind: 'hold', reason: 'nothing-pending' })
  })

  it('admits nothing when no candidate crosses the threshold', async () => {
    const plan = await skillContext.planAdmission(input({ evaluate: evaluator(0.2) }), configured())
    expect(plan).toEqual({ kind: 'admit', skills: [] })
  })

  it('admits candidates above the threshold', async () => {
    const plan = await skillContext.planAdmission(
      input({ snapshot: snapshot(['dsh-doc', 'dsh-code-review']) }),
      configured(),
    )
    if (plan.kind !== 'admit') throw new Error('expected an admission')
    expect(plan.skills.map(skill => skill.name)).toEqual(['dsh-doc', 'dsh-code-review'])
  })

  it('never re-admits a skill the window already holds', async () => {
    const plan = await skillContext.planAdmission(
      input({ snapshot: snapshot(['dsh-doc', 'dsh-code-review']), live: new Set(['dsh-doc']) }),
      configured(),
    )
    if (plan.kind !== 'admit') throw new Error('expected an admission')
    expect(plan.skills.map(skill => skill.name)).toEqual(['dsh-code-review'])
  })

  it('caps the admission at topK', async () => {
    const plan = await skillContext.planAdmission(
      input({ snapshot: snapshot(['a-skill', 'b-skill', 'c-skill']) }),
      configured({ topK: 2 }),
    )
    if (plan.kind !== 'admit') throw new Error('expected an admission')
    expect(plan.skills.map(skill => skill.name)).toEqual(['a-skill', 'b-skill'])
  })
})

describe('skillInjection', () => {
  it('emits one skill-invocation message carrying the skill body', () => {
    const message = skillContext.skillInjection(definition('dsh-doc'))
    expect(message.source).toMatchObject({ kind: 'skill-invocation', name: 'dsh-doc', form: 'instructions' })
    expect(JSON.stringify(message.content)).toContain('Body of dsh-doc.')
  })
})

describe('apply', () => {
  it('rejects a threshold outside (0, 1] at load', () => {
    const ctx = new Context()
    expect(() => { skillContext.apply(ctx, configured({ threshold: 0 })) }).toThrow(/threshold/)
  })

  it('rejects a non-positive topK at load', () => {
    const ctx = new Context()
    expect(() => { skillContext.apply(ctx, configured({ topK: 0 })) }).toThrow(/topK/)
  })

  it('rejects the typesafe provider without a pinned model identifier', () => {
    const ctx = new Context()
    expect(() => { skillContext.apply(ctx, configured({ model: '' })) }).toThrow(/model/)
  })
})

describe('liveSkillNames', () => {
  it('reads the surviving injections from the derived window', () => {
    const id = SessionId('skill-context-live')
    const session = Session.create(id, [], {
      version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: '/workspace', isSeeded: false,
    })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'plain' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'body' }],
      source: { kind: 'skill-invocation', name: 'dsh-doc', form: 'instructions' },
    }), { surfaceOp: 'append' })

    expect([...liveSkillNames(session)]).toEqual(['dsh-doc'])
  })
})
