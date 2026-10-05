// @vitest-environment jsdom
/**
 * The Efficiency rail entry and its token-efficiency window: pooled group
 * rates, fixed-column readings with bar-scale and per-model hovers, the
 * parent ladder, the unpriced empty state, and the rail/wide forms.
 */
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionCostProjection } from '@deepseek-ai/dsh-session-stats/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { TokenEfficiencyEntry, type TokenEfficiencyEntryProps } from '../src/client/settings/TokenEfficiencyEntry.tsx'
import {
  efficiencyReading, orderEfficiencyReadings, perMillionMicros, pooledRates, type EfficiencyReading,
} from '../src/client/contract/cost-metrics.ts'
import { en, zh } from '../src/client/locale.ts'

const tEn = makeTranslate(en, commonEn)
const tZh = makeTranslate(zh, commonZh)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** One fold entry: [uncached, output, cacheRead, cacheWrite] buckets plus its micros. */
interface SpendSpec { buckets: [number, number, number, number]; micros: number }

function cost(micros: number, perModel: Record<string, SpendSpec>): SessionCostProjection {
  const mapped = Object.fromEntries(Object.entries(perModel).map(([model, spec]) => [model, {
    uncachedInputTokens: spec.buckets[0],
    outputTokens: spec.buckets[1],
    cacheReadTokens: spec.buckets[2],
    cacheWriteTokens: spec.buckets[3],
    costMicros: spec.micros,
  }]))
  return {
    uncachedInputTokens: Object.values(mapped).reduce((s, m) => s + m.uncachedInputTokens, 0),
    outputTokens: Object.values(mapped).reduce((s, m) => s + m.outputTokens, 0),
    cacheReadTokens: Object.values(mapped).reduce((s, m) => s + m.cacheReadTokens, 0),
    cacheWriteTokens: Object.values(mapped).reduce((s, m) => s + m.cacheWriteTokens, 0),
    costMicros: micros,
    perModel: mapped,
    rates: {
      fallback: { inputPerMillionUsd: 1, outputPerMillionUsd: 1, cacheReadPerMillionUsd: 1, cacheWritePerMillionUsd: 1 },
      models: {},
    },
  }
}

/** One sessions-list row; only displayTitle, parentId, and sessionCost are read. */
function row(id: string, title: string, parentId: string | undefined, sessionCost: SessionCostProjection | undefined): {
  id: string
  displayTitle: string
  running: boolean
  blank: boolean
  updatedAt: number
  parentId?: string
  projectionValues?: { sessionCost: SessionCostProjection }
} {
  return {
    id, displayTitle: title, running: false, blank: false, updatedAt: 0,
    ...(parentId === undefined ? {} : { parentId }),
    ...(sessionCost === undefined ? {} : { projectionValues: { sessionCost } }),
  }
}

/** The reference listing from the approved mock, with internally consistent folds. */
function pricedRows() {
  return {
    audit: row('audit', 'Nightly audit sweep', undefined, cost(2_360_000, {
      qwen: { buckets: [940_000, 0, 60_000, 0], micros: 2_360_000 },
    })),
    refactor: row('refactor', 'Refactor auth to session-stats', undefined, cost(3_700_000, {
      'qwen3.8-max': { buckets: [550_000, 0, 2_250_000, 0], micros: 3_500_000 },
      'deepseek-v4': { buckets: [0, 0, 2_200_000, 0], micros: 200_000 },
    })),
    act: row('act', 'act: apply migration', 'refactor', cost(950_000, {
      qwen: { buckets: [130_000, 0, 370_000, 0], micros: 950_000 },
    })),
    explore: row('explore', 'explore: repo orientation', 'refactor', cost(150_000, {
      v4: { buckets: [80_000, 0, 920_000, 0], micros: 150_000 },
    })),
    deep: row('deep', 'explore: deep dive', 'explore', cost(20_000, {
      v4: { buckets: [50_000, 0, 50_000, 0], micros: 20_000 },
    })),
    docs: row('docs', 'Docs Q&A', undefined, cost(1_360_000, {
      a: { buckets: [100_000, 0, 1_000_000, 0], micros: 400_000 },
      b: { buckets: [100_000, 0, 1_000_000, 0], micros: 500_000 },
      c: { buckets: [180_000, 0, 1_320_000, 0], micros: 460_000 },
    })),
    v4only: row('v4only', 'Refactor auth (v4 only)', undefined, cost(630_000, {
      v4: { buckets: [675_000, 0, 3_825_000, 0], micros: 630_000 },
    })),
  }
}

function mount(rows: Record<string, unknown>, wide = true, t = tEn) {
  const snap = { byId: rows }
  const workspaces = { list: [] }
  const props = {
    useSessions: bindSnapshotSelector({
      getSnapshot: () => snap,
      subscribe: () => () => {},
    }),
    useWorkspaces: bindSnapshotSelector({
      getSnapshot: () => workspaces,
      subscribe: () => () => {},
    }),
    t,
    wide,
  } as unknown as TokenEfficiencyEntryProps
  return render(<TokenEfficiencyEntry {...props} />)
}

function open(view: ReturnType<typeof mount>, name = 'Efficiency') {
  const trigger = view.getByRole('button', { name })
  fireEvent.click(trigger)
  return view.getByRole('dialog')
}

describe('cost metrics', () => {
  const reading = (id: string, rate: number | null, parentId: string | null = null): EfficiencyReading => ({
    id,
    title: id,
    parentId,
    costMicros: rate ?? 0,
    tokens: 1,
    rateMicros: rate,
    cacheHit: null,
    models: 1,
    spendEntries: [],
    promptBuckets: { uncached: 0, cacheRead: 0, cacheWrite: 0 },
  })

  it('blends micros over tokens and refuses an unbilled fold', () => {
    expect(perMillionMicros(1_000_000, 1_000_000)).toBe(1_000_000)
    expect(perMillionMicros(500_000, 1_000_000)).toBe(500_000)
    expect(perMillionMicros(500_000, 0)).toBeNull()
  })

  it('ladders decoder rows under their roots by rate, roots by rate descending', () => {
    const ordered = orderEfficiencyReadings([
      reading('cheap', 1),
      reading('child', 9, 'dear'),
      reading('dear', 5),
      reading('orphan', 3, 'gone'),
    ])
    // dear before cheap; its child rides directly beneath it; the orphan
    // parentless row places as a root in rate order.
    expect(ordered.map(r => [r.id, r.depth])).toEqual([
      ['dear', 0], ['child', 1], ['orphan', 0], ['cheap', 0],
    ])
  })

  it('cuts a pure parent cycle instead of looping', () => {
    // The chain walk visits each member once: the rate-leading cycle node
    // becomes the ladder root and the follower rides one rung beneath.
    const ordered = orderEfficiencyReadings([reading('a', 2, 'b'), reading('b', 1, 'a')])
    expect(ordered.map(r => [r.id, r.depth])).toEqual([['a', 0], ['b', 1]])
  })

  it('pools micros over tokens per model-count group, never averaging rates', () => {
    const spend = (model: string): [string, import('@deepseek-ai/dsh-session-stats/client').CostModelSpend] => [
      model,
      { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1, costMicros: 1 },
    ]
    const root = (id: string, models: number, micros: number, tokens: number) => ({
      ...reading(id, micros / tokens),
      costMicros: micros,
      tokens,
      models,
      spendEntries: Array.from({ length: models }, (_, i) => spend(`${id}-${i}`)),
    })
    const ordered = orderEfficiencyReadings([
      root('s1', 1, 1_000_000, 1_000_000),
      root('s2', 1, 3_000_000, 1_000_000),
      root('m1', 2, 200_000, 1_000_000),
    ])
    const pooled = pooledRates(ordered)
    // Family micros over family tokens per group, divided once.
    expect(pooled.single).toMatchObject({ micros: 4_000_000, tokens: 2_000_000, rate: 2_000_000, sessions: 2 })
    expect(pooled.multi).toMatchObject({ micros: 200_000, tokens: 1_000_000, rate: 200_000, sessions: 1 })
    expect(pooled.priced).toBe(3)
  })

  it('rolls a session family over root plus subagent tree', () => {
    const asSummary = (summaryRow: ReturnType<typeof row>): SessionSummary =>
      summaryRow as unknown as SessionSummary
    const ordered = orderEfficiencyReadings([
      efficiencyReading('refactor', asSummary(pricedRows().refactor), pricedRows().refactor.projectionValues!.sessionCost),
      efficiencyReading('act', asSummary(pricedRows().act), pricedRows().act.projectionValues!.sessionCost),
      efficiencyReading('explore', asSummary(pricedRows().explore), pricedRows().explore.projectionValues!.sessionCost),
    ])
    const family = ordered[0]!.family!
    // Four distinct models across the tree, pooled spend per model.
    expect(family.models).toBe(4)
    expect(family.micros).toBe(4_800_000)
    expect(family.tokens).toBe(6_500_000)
    expect(family.entries.map(([model]) => model)).toEqual(['qwen3.8-max', 'qwen', 'deepseek-v4', 'v4'])
    // Children carry no family; the root rows alone do.
    expect(ordered[1]!.family).toBeNull()
  })
})

describe('TokenEfficiencyEntry', () => {
  it('renders the wide and rail forms and opens its window', () => {
    const wide = mount({})
    const wideButton = within(wide.container).getByRole('button')
    expect(wideButton.getAttribute('aria-label')).toBe('Efficiency')
    expect(wideButton.textContent).toContain('Efficiency')
    expect(wideButton.getAttribute('aria-haspopup')).toBe('dialog')
    expect(wideButton.getAttribute('aria-expanded')).toBe('false')

    const rail = mount({}, false)
    const railButton = within(rail.container).getByRole('button')
    expect(railButton.getAttribute('aria-label')).toBe('Efficiency')
    // Rail form carries the icon alone; the accessible name stays on the label.
    expect(railButton.textContent).toBe('')
  })

  it('shows the empty state when no deployment rates priced anything', () => {
    const view = mount({ audit: row('audit', 'Nightly audit sweep', undefined, undefined) })
    const dialog = open(view)
    expect(dialog.getAttribute('aria-label')).toBe('Token efficiency')
    // Portaled beside the RTL container, not inside it.
    expect(document.body.contains(dialog)).toBe(true)
    expect(view.container.contains(dialog)).toBe(false)
    expect(dialog.textContent).toContain('No priced sessions yet')
    expect(dialog.querySelector('table')).toBeNull()
  })

  it('nests subagent rows recursively under expanded ancestors only', () => {
    const view = mount(pricedRows())
    const dialog = open(view)
    const refactorCaret = view.getByRole('button', { name: 'Expand Refactor auth to session-stats' })
    const exploreCaret = () => view.getByRole('button', { name: 'Expand explore: repo orientation' })
    // The grandchild stays hidden while its own parent is folded, even
    // after the root unfolds one level.
    fireEvent.click(refactorCaret)
    expect([...dialog.querySelectorAll('tbody td:first-child')].map(td => td.textContent))
      .not.toContain('explore: deep dive')
    fireEvent.click(exploreCaret())
    const titles = [...dialog.querySelectorAll('tbody td:first-child')].map(td => td.textContent)
    expect(titles.indexOf('↳ ↳ explore: deep dive')).toBe(titles.indexOf('↳ explore: repo orientation') + 1)
    // Folding the root folds the whole subtree, expanded child included.
    fireEvent.click(refactorCaret)
    expect([...dialog.querySelectorAll('tbody td:first-child')].map(td => td.textContent))
      .not.toContain('↳ ↳ explore: deep dive')
  })

  it('lists session families by blended rate, collapsed to roots until expanded', () => {
    const view = mount(pricedRows())
    const dialog = open(view)
    // Pooled family micros over tokens per model-count group; never rate
    // averages; sessions count roots.
    expect(dialog.textContent).toContain('2+ model sessions pooled $0.600/M tok')
    expect(dialog.textContent).toContain('1-model sessions pooled $0.544/M tok')
    expect(dialog.textContent).toContain('4 priced session(s)')
    // Collapsed by default: the four roots only.
    let titles = [...dialog.querySelectorAll('tbody td:first-child')].map(td => td.textContent)
    expect(titles).toEqual([
      'Nightly audit sweep',
      'Refactor auth to session-stats',
      'Docs Q&A',
      'Refactor auth (v4 only)',
    ])
    // Expanding the refactor family ladders its subagent rows beneath it,
    // deepest rates first; collapsing folds them away again.
    const caret = view.getByRole('button', { name: 'Expand Refactor auth to session-stats' })
    fireEvent.click(caret)
    expect(caret.getAttribute('aria-expanded')).toBe('true')
    titles = [...dialog.querySelectorAll('tbody td:first-child')].map(td => td.textContent)
    expect(titles).toEqual([
      'Nightly audit sweep',
      'Refactor auth to session-stats',
      '↳ act: apply migration',
      '↳ explore: repo orientation',
      'Docs Q&A',
      'Refactor auth (v4 only)',
    ])
    const rates = [...dialog.querySelectorAll('tbody td:nth-child(4)')].map(td => td.textContent)
    expect(rates).toEqual(['$2.36', '$0.730', '$1.90', '$0.150', '$0.368', '$0.140'])
    const spends = [...dialog.querySelectorAll('tbody td:nth-child(5)')].map(td => td.textContent)
    expect(spends).toEqual(['$2.36', '$4.82', '$0.950', '$0.150', '$1.36', '$0.630'])
    // The models column: session-family model counts on roots (subagents
    // pooled into their root), own-fold counts on detail rows.
    const models = [...dialog.querySelectorAll('tbody td:nth-child(2)')].map(td => td.textContent)
    expect(models).toEqual(['1', '4', '1', '1', '3', '1'])
    // Cache hit rides the displayed buckets: pooled on roots, own below.
    const hits = [...dialog.querySelectorAll('tbody td:nth-child(6)')].map(td => td.textContent)
    expect(hits).toEqual(['6%', '82%', '74%', '92%', '90%', '85%'])
    fireEvent.click(caret)
    expect(caret.getAttribute('aria-expanded')).toBe('false')
    titles = [...dialog.querySelectorAll('tbody td:first-child')].map(td => td.textContent)
    expect(titles).toHaveLength(4)
  })

  it('opens the per-model listing when the Models cell is hovered', () => {
    const view = mount(pricedRows())
    const dialog = open(view)
    const mixedCell = [...dialog.querySelectorAll('tbody td:nth-child(2) span')][1]!
    fireEvent.mouseOver(mixedCell)
    const tip = view.getByRole('tooltip')
    expect(tip.textContent).toContain('Refactor auth to session-stats · 4 model(s) logged')
    expect(tip.textContent).toContain('qwen3.8-max — $3.50 · 2.8M')
    expect(tip.textContent).toContain('qwen — $0.950 · 500K')
    expect(tip.textContent).toContain('deepseek-v4 — $0.200 · 2.2M')
    fireEvent.mouseOut(mixedCell)
    expect(view.queryByRole('tooltip')).toBeNull()
  })

  it('names the bar scale value and max when the track is hovered', () => {
    const view = mount(pricedRows())
    const dialog = open(view)
    // Collapsed roots: audit 0, refactor 1, docs 2, v4only 3.
    const docsTrack = [...dialog.querySelectorAll('tbody td:nth-child(3) span')][2]!
    fireEvent.mouseOver(docsTrack)
    const tip = view.getByRole('tooltip')
    // The docs row's 0.368 rate is a 16% share of the 2.36 max.
    expect(tip.textContent).toContain('value — 16% of max')
    expect(tip.textContent).toContain('max — $2.36/M tok')
    fireEvent.mouseOut(docsTrack)
    expect(view.queryByRole('tooltip')).toBeNull()
  })

  it('closes on Escape and on mask click, restoring trigger focus', () => {
    const view = mount(pricedRows())
    const trigger = view.getByRole('button', { name: 'Efficiency' })
    fireEvent.click(trigger)
    expect(view.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    fireEvent.click(trigger)
    const overlay = view.getByRole('dialog').parentElement!
    fireEvent.click(overlay.firstElementChild!)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('reads the window copy from the active locale', () => {
    const view = mount(pricedRows(), true, tZh)
    const dialog = open(view, '效能')
    expect(dialog.getAttribute('aria-label')).toBe('Token 效能')
    expect(dialog.textContent).toContain('2+ 模型会话综合 $0.600/M tok')
    expect(dialog.textContent).toContain('会话')
  })

  it('zero-bars a priced row that billed spend but no tokens', () => {
    const view = mount({
      zero: row('zero', 'Zero-token charge', undefined, cost(500_000, {
        m: { buckets: [0, 0, 0, 0], micros: 500_000 },
      })),
      zero2: row('zero2', 'Another zero', undefined, cost(200_000, {
        m: { buckets: [0, 0, 0, 0], micros: 200_000 },
      })),
    })
    const dialog = open(view)
    const rates = [...dialog.querySelectorAll('tbody td:nth-child(4)')].map(td => td.textContent)
    expect(rates).toEqual(['$0.00', '$0.00'])
    const hits = [...dialog.querySelectorAll('tbody td:nth-child(6)')].map(td => td.textContent)
    expect(hits).toEqual(['', ''])
    // The bar reports the scale honestly: zero of an absent max.
    const track = dialog.querySelector('tbody td:nth-child(3) span')!
    fireEvent.mouseOver(track)
    const tip = view.getByRole('tooltip')
    expect(tip.textContent).toContain('value — 0% of max')
    expect(tip.textContent).toContain('max — $0.00/M tok')
    fireEvent.mouseOut(track)
  })

  it('names the unlogged model in the per-model listing', () => {
    const view = mount({ odd: row('odd', 'Odd fold', undefined, cost(100_000, {
      '': { buckets: [10_000, 0, 0, 0], micros: 100_000 },
    })) })
    const dialog = open(view)
    const cell = dialog.querySelector('tbody td:nth-child(2) span')!
    fireEvent.mouseOver(cell)
    expect(view.getByRole('tooltip').textContent).toContain('unlogged model — $0.100 · 10K')
    fireEvent.mouseOut(cell)
  })
})
