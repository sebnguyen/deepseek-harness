// @vitest-environment jsdom

import type { SessionCostProjection } from '@deepseek-ai/dsh-session-stats/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type {
  AssistantMessageNode, ChatSnapshot, LegacyConversationSlice, ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import {
  StatsPills, deriveStats, formatDuration, lastRequestTps, type StatsPillsProps,
} from '../src/client/chat/StatsPills.tsx'
import { formatUsdMicros } from '../src/client/chat/token-format.ts'
import { formatTokens } from '../src/client/chat/token-format.ts'
import { en, zh } from '../src/client/locale.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

const t: StatsPillsProps['t'] = makeTranslate(zh, commonZh)
const tEn: StatsPillsProps['t'] = makeTranslate(en, commonEn)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/**
 * A served sessionCost value: one model route is declared beside the
 * fallback, and the per-model fold carries the same totals. The buckets sum
 * to exactly one million billed tokens, so the blended per-million figure
 * equals the headline amount's figure.
 */
function COST_FIXTURE(micros: number): SessionCostProjection {
  return {
    uncachedInputTokens: 250_000,
    outputTokens: 500_000,
    cacheReadTokens: 250_000,
    cacheWriteTokens: 0,
    costMicros: micros,
    perModel: {
      'qwen3.8-max': { uncachedInputTokens: 250_000, outputTokens: 500_000, cacheReadTokens: 250_000, cacheWriteTokens: 0, costMicros: micros },
    },
    rates: {
      fallback: { inputPerMillionUsd: 0.14, outputPerMillionUsd: 0.28, cacheReadPerMillionUsd: 0.028, cacheWritePerMillionUsd: 0 },
      models: {
        'qwen3.8-max': { inputPerMillionUsd: 2, outputPerMillionUsd: 6, cacheReadPerMillionUsd: 0.2, cacheWritePerMillionUsd: 0 },
      },
    },
  }
}

const assistant = (seq: number, turn: number, usage?: unknown): AssistantMessageNode => ({
  kind: 'assistant', seq, time: seq * 1_000, turn, step: seq, blocks: [{ kind: 'text', text: `t${seq}` }],
  ...(usage === undefined ? {} : { usage }),
})

type ChatUpdate = Partial<LegacyConversationSlice>

function makeSource(init: ChatUpdate = {}) {
  let snap = chatSnapshotFixture(init)
  const subs = new Set<() => void>()
  return {
    set: (next: ChatUpdate) => {
      snap = chatSnapshotFixture({ ...snap.legacy, ...next }, snap)
      for (const fn of [...subs]) fn()
    },
    source: {
      getSnapshot: () => snap,
      subscribe: (fn: () => void) => {
        subs.add(fn)
        return () => subs.delete(fn)
      },
    },
  }
}

describe('deriveStats', () => {
  it('counts turns and steps and never folds node usage into accounting', () => {
    const stats = deriveStats([
      assistant(1, 1, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 900 }),
      assistant(2, 1, { inputTokens: 100, outputTokens: 50 }),
      assistant(3, 2),
    ])
    expect(stats.turns).toBe(2)
    expect(stats.steps).toBe(3)
    // The window fold's counts are only the fallback for assemblies without
    // the sessionStats projection; the paged window is not an accounting
    // source either, so the fold exposes no billing fields (billing rides the
    // tokenUsage projection); decodeTokens is a throughput input, not a
    // billed total.
    expect(Object.keys(stats).sort()).toEqual(
      ['decodeMs', 'decodeTokens', 'llmMs', 'steps', 'toolMs', 'ttftMs', 'ttftSteps', 'turns'],
    )
  })

  it('ignores tool results with no call time', () => {
    const tool: ToolResultNode = {
      kind: 'tool-result', seq: 5, time: 5_000, callId: 'c', call: null, callTime: null, content: [],
      isError: false, subCalls: [],
    }
    const stats = deriveStats([tool, assistant(1, 1)])
    expect(stats.steps).toBe(1)
    expect(stats.toolMs).toBe(0)
  })

  it('sums LLM wall time from assistant timing and tool wall time from call/result pairs', () => {
    const timed: AssistantMessageNode = {
      ...assistant(1, 1),
      timing: { stepStartTime: 1_000, firstTokenTime: 1_200, completedTime: 3_500 },
    }
    const untimed: AssistantMessageNode = {
      ...assistant(2, 1),
      timing: { stepStartTime: null, firstTokenTime: null, completedTime: 9_000 },
    }
    const tool: ToolResultNode = {
      kind: 'tool-result', seq: 5, time: 7_000, callId: 'c', call: null, callTime: 4_000, content: [],
      isError: false, subCalls: [],
    }
    const stats = deriveStats([timed, untimed, tool])
    expect(stats.llmMs).toBe(2_500)
    expect(stats.toolMs).toBe(3_000)
  })

  it('sums ttft per recorded step and decode throughput inputs per usage-carrying step', () => {
    const sampled: AssistantMessageNode = {
      ...assistant(1, 1, { outputTokens: 40 }),
      timing: { stepStartTime: 1_000, firstTokenTime: 1_800, completedTime: 4_800 },
    }
    const ttftOnly: AssistantMessageNode = {
      ...assistant(2, 1),
      timing: { stepStartTime: 5_000, firstTokenTime: 5_400, completedTime: 7_400 },
    }
    const stats = deriveStats([sampled, ttftOnly, assistant(3, 2)])
    expect(stats.ttftMs).toBe(1_200)
    expect(stats.ttftSteps).toBe(2)
    // The usage-less step contributes no decode share, keeping the ratio honest.
    expect(stats.decodeMs).toBe(3_000)
    expect(stats.decodeTokens).toBe(40)
  })
})

describe('lastRequestTps', () => {
  const timed = (seq: number, usage?: unknown): AssistantMessageNode => ({
    ...assistant(seq, 1, usage),
    timing: { stepStartTime: 1_000, firstTokenTime: 1_800, completedTime: 4_800 },
  })

  it('returns null until some settled step carries both timing and usage', () => {
    expect(lastRequestTps([])).toBeNull()
    expect(lastRequestTps([assistant(1, 1), timed(2)])).toBeNull()
  })

  it('reads the newest sampled step and skips unsampled tails', () => {
    const zeroDecode: AssistantMessageNode = {
      ...assistant(3, 2, { outputTokens: 9 }),
      timing: { stepStartTime: 1_000, firstTokenTime: 1_800, completedTime: 1_800 },
    }
    const tool: ToolResultNode = {
      kind: 'tool-result', seq: 4, time: 9_000, callId: 'c', call: null, callTime: null, content: [],
      isError: false, subCalls: [],
    }
    // 60 tokens over a 3s decode → 20 tok/s; later zero-decode, usage-less, or
    // tool nodes are skipped in favor of it.
    expect(lastRequestTps([timed(1, { outputTokens: 60 }), zeroDecode, tool])).toBe(20)
    expect(lastRequestTps([timed(1, { outputTokens: 60 }), timed(2, { outputTokens: 30 })])).toBe(10)
  })
})

describe('formatters', () => {
  it('formats token counts compactly', () => {
    expect(formatTokens(517, tEn)).toBe('517')
    expect(formatTokens(12_240, tEn)).toBe('12.2K')
    expect(formatTokens(517_000, tEn)).toBe('517K')
    expect(formatTokens(1_230_000, tEn)).toBe('1.2M')
  })

  it('forms compact USD spend text from micro dollars', () => {
    expect(formatUsdMicros(0, tEn)).toBe('$0.00')
    expect(formatUsdMicros(34_200, tEn)).toBe('$0.0342')
    expect(formatUsdMicros(850_000, tEn)).toBe('$0.850')
    expect(formatUsdMicros(1_850_000, tEn)).toBe('$1.85')
    expect(formatUsdMicros(12_345_000, tEn)).toBe('$12.35')
    expect(formatUsdMicros(1_234_567_000, tEn)).toBe('$1,234.57')
  })

  it('formats durations under and over a minute', () => {
    expect(formatDuration(45_230, tEn)).toBe('45.2s')
    expect(formatDuration(162_000, tEn)).toBe('2m42s')
  })
})

describe('StatsPills', () => {
  const USAGE = { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 90, cacheWriteTokens: 0 }

  /** A whole-log sessionStats value: zeros plus overrides. */
  function sessionStats(overrides: Record<string, number>): Record<string, number> {
    return {
      turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
      ...overrides,
    }
  }

  /** Stub the projection seat: a key-addressed table of whole values. */
  function projections(values: Record<string, unknown>): StatsPillsProps['useProjection'] {
    return (key: string) => values[key]
  }

  /** Stub the sessions-list seat: only the byId rows are read. */
  function sessionsList(rows: Record<string, unknown>): StatsPillsProps['useSessions'] {
    const snap = { byId: rows }
    return bindSnapshotSelector({
      getSnapshot: () => snap,
      subscribe: () => () => {},
    }) as unknown as StatsPillsProps['useSessions']
  }

  function props(
    source: { getSnapshot(): ChatSnapshot; subscribe(fn: () => void): () => void },
    values: Record<string, unknown> = { tokenUsage: USAGE },
    rows: Record<string, unknown> = {},
  ): StatsPillsProps {
    return {
      useChat: bindSnapshotSelector(source),
      useProjection: projections(values),
      useSessions: sessionsList(rows),
      sessionId: 'root' as SessionId,
      t: tEn,
    }
  }

  function tokenUsage(cacheReadTokens: number, uncachedInputTokens: number) {
    return { uncachedInputTokens, outputTokens: 1, cacheReadTokens, cacheWriteTokens: 0 }
  }

  /** A step whose timing yields 3.8s LLM, 0.8s TTFT, and 20 tok/s over 60 tokens. */
  const timedStep = (): AssistantMessageNode => ({
    ...assistant(1, 1, { outputTokens: 60 }),
    timing: { stepStartTime: 1_000, firstTokenTime: 1_800, completedTime: 4_800 },
  })

  it('renders the counts reading and usage pill and hides a brand-new empty session', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source)} />)
    // InputBar's `.root:has([data-composer-stats])` bottom-clearance rule keys
    // off this attribute: present exactly while the row renders.
    expect(view.container.querySelector('[data-composer-stats]')).toBeTruthy()
    // No timing on the fixture: the speed segment drops out and the dialog
    // would have no rows, so the counts reading stays a static pill (no button).
    expect(view.getByText('1 turns 1 steps').closest('button')).toBeNull()
    // Hit comes from the projection, so paging the window cannot change
    // it; the usage pill leads with the whole-log token total. Its accessible
    // name separates the segments the visual sep glyph joins.
    const usagePill = view.getAllByRole('button')
    expect(usagePill.map(pill => pill.textContent)).toEqual(['In 10·Cache 90·Out 5·Hit 90%'])
    expect(usagePill[0]!.getAttribute('aria-label')).toBe('In 10 · Cache 90 · Out 5 · Hit 90%')
    const empty = makeSource()
    const emptyView = render(<StatsPills {...props(empty.source, {
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      contextPressure: {},
    })} />)
    expect(emptyView.container.textContent).toBe('')
    expect(emptyView.container.querySelector('[data-composer-stats]')).toBeNull()
  })

  it.each([
    { actual: '98.6%', tokenUsageValue: tokenUsage(986, 14), expected: 'Hit 99%' },
    { actual: '99.1%', tokenUsageValue: tokenUsage(991, 9), expected: 'Hit 99%' },
    { actual: '99.49%', tokenUsageValue: tokenUsage(9_949, 51), expected: 'Hit 99%' },
    { actual: '99.5%', tokenUsageValue: tokenUsage(995, 5), expected: 'Hit 99.5%' },
    { actual: '99.94%', tokenUsageValue: tokenUsage(9_994, 6), expected: 'Hit 99.9%' },
    { actual: '99.95%', tokenUsageValue: tokenUsage(9_995, 5), expected: 'Hit 99.95%' },
    { actual: '99.955%', tokenUsageValue: tokenUsage(19_991, 9), expected: 'Hit 99.96%' },
    { actual: '99.985%', tokenUsageValue: tokenUsage(19_997, 3), expected: 'Hit 99.99%' },
    { actual: '99.995%', tokenUsageValue: tokenUsage(19_999, 1), expected: 'Hit 99.995%' },
    { actual: '99.9975%', tokenUsageValue: tokenUsage(39_999, 1), expected: 'Hit 99.998%' },
    {
      actual: 'the closest non-full ratio available from safe integer cumulative counts',
      tokenUsageValue: tokenUsage(Number.MAX_SAFE_INTEGER - 1, 1),
      expected: 'Hit 99.99999999999999%',
    },
    { actual: '100%', tokenUsageValue: tokenUsage(10_000, 0), expected: 'Hit 100%' },
  ])('formats an actual $actual cache-hit ratio as $expected', ({ tokenUsageValue, expected }) => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, { tokenUsage: tokenUsageValue })} />)
    expect(view.getAllByRole('button')[0]!.textContent).toContain(expected)
  })

  it('exposes output speed on the counts pill when decode timing exists', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source)} />)
    const timePill = view.getAllByRole('button')[0]!
    expect(timePill.textContent).toBe('1 turns 1 steps·Avg 20 tok/s·Last 20 tok/s')
    expect(timePill.getAttribute('aria-label')).toBe('1 turns 1 steps · Avg 20 tok/s · Last 20 tok/s')
  })

  it('click-opens the time-and-speed dialog carrying the time split and speeds', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source)} />)

    const timePill = view.getAllByRole('button')[0]!
    expect(timePill.getAttribute('aria-haspopup')).toBe('dialog')
    expect(timePill.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByRole('dialog')).toBeNull()

    fireEvent.click(timePill)
    expect(timePill.getAttribute('aria-expanded')).toBe('true')
    const dialog = view.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Session statistics')
    // Portaled out of the composer dock.
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog.firstChild?.textContent).toBe('Session statistics')
    const details = dialog.querySelector('[data-session-stats-details]') as HTMLElement
    expect(details).toBeTruthy()
    expect(details.textContent).toContain('LLM time3.8s')
    // No tool call in this session: the row is absent, not zeroed.
    expect(details.textContent).not.toContain('Tool time')
    expect(details.textContent).toContain('Avg time to first token (TTFT)0.8s')
    expect(details.textContent).toContain('Average tokens per second (TPS)20 tok/s')
    expect(details.textContent).toContain('Last request speed20 tok/s')
    // Token accounting lives on the usage pill's own dialog, not here.
    expect(dialog.textContent).not.toContain('Token usage')
  })

  it('click-opens the token-usage dialog carrying the headline total and exact buckets', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source)} />)

    const usagePill = view.getAllByRole('button')[1]!
    fireEvent.click(usagePill)
    expect(usagePill.getAttribute('aria-expanded')).toBe('true')
    const dialog = view.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Token usage')
    expect(dialog.parentElement).toBe(document.body)
    // Headline total: all prompt-side buckets (10 + 90 + 0) plus output (5).
    expect(dialog.firstChild?.textContent).toBe('Token usage105 tok')
    const tokens = dialog.querySelector('[data-session-stats-usage]') as HTMLElement
    expect(tokens).toBeTruthy()
    expect(tokens.textContent).toContain('Cache hit90%')
    expect(tokens.textContent).toContain('Uncached input10 tok')
    expect(tokens.textContent).toContain('Cached input90 tok')
    // A session that never wrote cache drops the row rather than showing 0.
    expect(tokens.textContent).not.toContain('Cache write')
    expect(tokens.textContent).toContain('Output5 tok')
    // The time split lives on the counts pill's own dialog, not here.
    expect(dialog.textContent).not.toContain('LLM time')
  })

  it('closes the dialog on Escape or outside pointerdown', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source)} />)
    const timePill = view.getAllByRole('button')[0]!

    fireEvent.click(timePill)
    expect(view.queryByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(timePill.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(timePill)
    // A pointerdown inside the panel keeps it open; one outside closes it.
    fireEvent.pointerDown(view.getByRole('dialog'))
    expect(view.queryByRole('dialog')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('keeps at most one dialog open: a sibling pill click swaps, never stacks', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source)} />)
    const [timePill, usagePill] = [...view.getAllByRole('button')] as [HTMLElement, HTMLElement]

    fireEvent.click(timePill)
    expect(view.getByRole('dialog').getAttribute('aria-label')).toBe('Session statistics')
    fireEvent.click(usagePill)
    const dialogs = view.getAllByRole('dialog')
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0]!.getAttribute('aria-label')).toBe('Token usage')
    expect(timePill.getAttribute('aria-expanded')).toBe('false')
    expect(usagePill.getAttribute('aria-expanded')).toBe('true')
  })

  it('takes every pill and dialog label from the active locale', () => {
    const { source } = makeSource({ nodes: [timedStep()] })
    const view = render(<StatsPills {...props(source, { tokenUsage: tokenUsage(9_995, 5) })} t={t} />)
    const [timePill, usagePill] = [...view.getAllByRole('button')] as [HTMLElement, HTMLElement]
    expect(timePill.textContent).toBe('1 轮 1 步·平均 20 tok/s·上次 20 tok/s')
    // cacheRead 9995 compacts to 10K.
    expect(usagePill.textContent).toBe('输入 5·缓存 10K·输出 1·命中 99.95%')
    fireEvent.click(timePill)
    const timeDialog = view.getByRole('dialog')
    expect(timeDialog.getAttribute('aria-label')).toBe('会话统计')
    expect(timeDialog.textContent).toContain('模型用时3.8秒')
    expect(timeDialog.textContent).toContain('首 token 平均（TTFT）0.8秒')
    expect(timeDialog.textContent).toContain('平均输出速度（TPS）20 tok/s')
    expect(timeDialog.textContent).toContain('上次请求速度20 tok/s')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(usagePill)
    const usageDialog = view.getByRole('dialog')
    expect(usageDialog.getAttribute('aria-label')).toBe('Token 用量')
    expect(usageDialog.textContent).toContain('未缓存输入5 tok')
  })

  it('keeps the durable usage pill after the visible step window is empty', () => {
    const { source } = makeSource()
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      contextPressure: { pressureTokens: 32_000, contextWindow: 128_000 },
    })} />)
    // Context occupancy lives on the composer's ContextMeter ring, not here.
    const pills = view.getAllByRole('button')
    expect(pills).toHaveLength(1)
    expect(pills[0]!.textContent).toBe('In 10·Cache 90·Out 5·Hit 90%')
  })

  it('drops the usage pill when no projection is composed', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {})} />)
    expect(view.container.textContent).toBe('1 turns 1 steps')
    // The untimed window has no dialog rows either, so no button renders at all.
    expect(view.queryAllByRole('button')).toHaveLength(0)
  })

  it('renders whole-session counts from the sessionStats projection over the paged window', () => {
    // The bug's acceptance at unit level: one loaded page must not scope the
    // counter — the durable projection's totals win over the window fold.
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionStats: sessionStats({ turns: 10, steps: 89 }),
    })} />)
    expect(view.getByText('10 turns 89 steps')).toBeTruthy()
  })

  it('treats a defined zero-count projection as empty, not as fallback', () => {
    // A composed unit always serves the key; all-zero genuinely means no
    // closed step in the whole log, so nothing renders on a brand-new session.
    const empty = makeSource()
    const view = render(<StatsPills {...props(empty.source, {
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      sessionStats: sessionStats({}),
    })} />)
    expect(view.container.textContent).toBe('')
  })

  it('hides the usage pill when steps closed without any billed activity', () => {
    // A session whose only turn failed before billing (e.g. an auth error):
    // the counts pill renders alone, not an uninformative zero-token pill.
    const { source } = makeSource()
    const view = render(<StatsPills {...props(source, {
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      sessionStats: sessionStats({ turns: 1, steps: 1 }),
    })} />)
    expect(view.container.textContent).toBe('1 turns 1 steps')
    expect(view.queryAllByRole('button')).toHaveLength(0)
  })

  it('keeps the counts pill over an empty visible window when the projection carries totals', () => {
    // Extends the durable-groups guarantee: full-session counts survive a
    // window that compaction (or paging) left without assistant nodes.
    const { source } = makeSource()
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionStats: sessionStats({ turns: 7, steps: 44 }),
    })} />)
    expect(view.getByText('7 turns 44 steps')).toBeTruthy()
  })

  it('renders whole-log speed and dialog figures from the projection, not the loaded window', () => {
    // The 加载更早 hazard beyond counts: the pill's speed segment and the
    // dialog's time split, TTFT, and throughput must not grow per loaded page
    // either. An untimed 1-node window renders the projection's whole-log figures.
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionStats: sessionStats({
        turns: 200, steps: 200, llmMs: 100_000, toolMs: 62_000,
        ttftMs: 1_600, ttftSteps: 2, decodeMs: 3_000, decodeTokens: 60,
      }),
    })} />)
    const timePill = view.getAllByRole('button')[0]!
    // The untimed loaded window yields no last-request reading: only the
    // projection-backed average renders.
    expect(timePill.textContent).toBe('200 turns 200 steps·Avg 20 tok/s')
    fireEvent.click(timePill)
    const dialog = view.getByRole('dialog')
    expect(dialog.textContent).toContain('LLM time1m40s')
    expect(dialog.textContent).toContain('Tool time1m2s')
    expect(dialog.textContent).toContain('Avg time to first token (TTFT)0.8s')
    expect(dialog.textContent).toContain('Average tokens per second (TPS)20 tok/s')
    expect(dialog.textContent).not.toContain('Last request speed')
  })

  it('omits the cache-hit segment when nothing was billed on the input side', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: { uncachedInputTokens: 0, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })} />)
    const usagePill = view.getAllByRole('button')[0]!
    expect(usagePill.textContent).toBe('In 0·Cache 0·Out 7')
    expect(usagePill.getAttribute('aria-label')).toBe('In 0 · Cache 0 · Out 7')
    // Output-only activity still fills the dialog's token rows.
    fireEvent.click(usagePill)
    expect(view.getByRole('dialog').textContent).toContain('Output7 tok')
  })

  it('includes cache writes in the total and the cache-hit denominator', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: {
        uncachedInputTokens: 10,
        outputTokens: 7,
        cacheReadTokens: 90,
        cacheWriteTokens: 100,
      },
    })} />)
    expect(view.getAllByRole('button')[0]!.textContent).toBe('In 10·Cache 90·Out 7·Hit 45%')
    // A session that did write cache keeps the row, exact.
    fireEvent.click(view.getAllByRole('button')[0]!)
    expect(view.getByRole('dialog').textContent).toContain('Cache write100 tok')
  })

  it.each([
    { micros: 0, expected: 'Cost $0.00' },
    { micros: 34_200, expected: 'Cost $0.0342' },
    { micros: 850_000, expected: 'Cost $0.850' },
    { micros: 1_850_000, expected: 'Cost $1.85' },
  ])('renders the cost pill with the live blended rate ($expected)', ({ micros, expected }) => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionCost: COST_FIXTURE(micros),
    })} />)
    // The rate segment spreads the same figure over the fixture's one million
    // billed tokens, so per-million equals the headline amount.
    expect(view.container.textContent).toContain(`${expected}·${expected.slice('Cost '.length)}/M tok`)
  })

  it('click-opens the spend dialog carrying the blended rate, cache hit, and per-model rows', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionCost: COST_FIXTURE(1_000_000),
    })} />)
    // The row renders several pills; the cost one is the button showing the amount.
    const costPill = [...view.getAllByRole('button')].find(el => el.textContent.includes('$'))!
    expect(costPill.getAttribute('aria-haspopup')).toBe('dialog')
    expect(view.queryByRole('dialog')).toBeNull()
    fireEvent.click(costPill)
    expect(costPill.getAttribute('aria-expanded')).toBe('true')
    const dialog = view.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Spend')
    // Portaled out of the composer dock, headline amount in the title row.
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog.firstChild?.textContent).toBe('Spend$1.00')
    const details = dialog.querySelector('[data-session-stats-cost]') as HTMLElement
    expect(details).toBeTruthy()
    expect(details.textContent).toContain('Per 1M tok$1.00/M tok')
    // 250K cache read of 500K prompt-side tokens.
    expect(details.textContent).toContain('Cache hit50%')
    expect(details.textContent).toContain('qwen3.8-max$1.00 · 1M')
    // No descendants: no rollup row.
    expect(details.textContent).not.toContain('Subagent sessions')
  })

  it('lists an unlogged-model spend row and breaks micros ties by model name', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const unlogged: SessionCostProjection = {
      ...COST_FIXTURE(600_000),
      perModel: {
        '': { uncachedInputTokens: 3, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 300_000 },
        mock: { uncachedInputTokens: 2, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 300_000 },
      },
    }
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionCost: unlogged,
    })} />)
    fireEvent.click([...view.getAllByRole('button')].find(el => el.textContent.includes('$'))!)
    const text = view.getByRole('dialog').textContent
    // Equal micros order by model name: the empty key's replacement sorts first.
    expect(text.indexOf('unlogged model$0.300 · 4')).toBeLessThan(text.indexOf('mock$0.300 · 3'))
  })

  /** One list row; only parentId and projectionValues are read by the rollup. */
  function costRow(parentId: string | undefined, cost: SessionCostProjection | undefined): Record<string, unknown> {
    return {
      id: 'row', displayTitle: 'row', running: false, blank: false, updatedAt: 0,
      ...(parentId === undefined ? {} : { parentId }),
      ...(cost === undefined ? {} : { projectionValues: { sessionCost: cost } }),
    }
  }

  it('rolls descendant subagent sessions into the spend dialog', () => {
    const child: SessionCostProjection = {
      ...COST_FIXTURE(700_000),
      perModel: {
        'qwen3.8-max': { uncachedInputTokens: 100_000, outputTokens: 100_000, cacheReadTokens: 100_000, cacheWriteTokens: 0, costMicros: 200_000 },
        'deepseek-v4': { uncachedInputTokens: 200_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 500_000 },
      },
    }
    const grand: SessionCostProjection = {
      ...COST_FIXTURE(100_000),
      perModel: {
        'deepseek-v4': { uncachedInputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 100_000 },
      },
    }
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionCost: COST_FIXTURE(1_000_000),
    }, {
      root: costRow(undefined, undefined),
      child: costRow('root', child),
      grand: costRow('child', grand),
      unpriced: costRow('root', undefined),
    })} />)
    fireEvent.click([...view.getAllByRole('button')].find(el => el.textContent.includes('$'))!)
    const text = view.getByRole('dialog').textContent
    // Shared model keys merge across the tree; the rest keep their own row.
    expect(text).toContain('qwen3.8-max$1.20 · 1.3M')
    expect(text).toContain('deepseek-v4$0.600 · 300K')
    // Most expensive first.
    expect(text.indexOf('qwen3.8-max')).toBeLessThan(text.indexOf('deepseek-v4'))
    // Two priced descendants plus one unpriced one all count as included.
    expect(text).toContain('Subagent sessions3')
  })

  it('cuts a cyclic parent chain instead of looping', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionCost: COST_FIXTURE(1_000_000),
    }, {
      // The viewed session's own row loops back through its descendants.
      root: costRow('c2', undefined),
      c1: costRow('root', COST_FIXTURE(100_000)),
      c2: costRow('c1', undefined),
    })} />)
    fireEvent.click([...view.getAllByRole('button')].find(el => el.textContent.includes('$'))!)
    expect(view.getByRole('dialog').textContent).toContain('Subagent sessions2')
  })

  it('drops the blended-rate reading when the fold billed no tokens', () => {
    const zero: SessionCostProjection = {
      ...COST_FIXTURE(0), uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, perModel: {},
    }
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionCost: zero,
    })} />)
    const costPill = [...view.getAllByRole('button')].find(el => el.textContent.includes('$'))!
    expect(costPill.textContent).toBe('Cost $0.00')
    fireEvent.click(costPill)
    const details = view.getByRole('dialog').querySelector('[data-session-stats-cost]') as HTMLElement
    expect(details.textContent).not.toContain('Per 1M tok')
    expect(details.textContent).not.toContain('Cache hit')
  })

  it('keeps the blended rate but drops the cache-hit row on output-only spend', () => {
    const outOnly: SessionCostProjection = {
      ...COST_FIXTURE(500_000),
      uncachedInputTokens: 0,
      cacheReadTokens: 0,
      perModel: {
        'qwen3.8-max': { uncachedInputTokens: 0, outputTokens: 500_000, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 500_000 },
      },
    }
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionCost: outOnly,
    })} />)
    const costPill = [...view.getAllByRole('button')].find(el => el.textContent.includes('$'))!
    expect(costPill.textContent).toBe('Cost $0.500·$1.00/M tok')
    fireEvent.click(costPill)
    const details = view.getByRole('dialog').querySelector('[data-session-stats-cost]') as HTMLElement
    expect(details.textContent).toContain('Per 1M tok$1.00/M tok')
    expect(details.textContent).not.toContain('Cache hit')
  })

  it('takes the spend pill and dialog copy from the active locale', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source, {
      tokenUsage: USAGE,
      sessionCost: COST_FIXTURE(1_000_000),
    })} t={t} />)
    const costPill = [...view.getAllByRole('button')].find(el => el.textContent.includes('$'))!
    expect(costPill.textContent).toBe('费用 $1.00·$1.00/百万 tok')
    fireEvent.click(costPill)
    const dialog = view.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('花费')
    const details = dialog.querySelector('[data-session-stats-cost]') as HTMLElement
    expect(details.textContent).toContain('每百万 tok$1.00/百万 tok')
    expect(details.textContent).toContain('缓存命中50%')
  })

  it('renders no cost pill when the deployment declared no rates', () => {
    const { source } = makeSource({ nodes: [assistant(1, 1)] })
    const view = render(<StatsPills {...props(source)} />)
    expect(view.container.textContent).not.toContain('Cost $')
  })

  it('renders ZERO times during streaming chunk frames (RFC hard acceptance)', () => {
    const { set, source } = makeSource({ nodes: [assistant(1, 1)] })
    let renders = 0
    function Counting(p: StatsPillsProps) {
      renders += 1
      return <StatsPills {...p} />
    }
    render(<Counting {...props(source)} />)
    const before = renders
    // Chunk frames swap partial only; nodes keeps its reference (object-layer contract).
    act(() => { set({ partial: { turn: 1, step: 2, blocks: [{ kind: 'text', text: 'a' }] } }) })
    act(() => { set({ partial: { turn: 1, step: 2, blocks: [{ kind: 'text', text: 'ab' }] } }) })
    expect(renders).toBe(before)
  })
})
