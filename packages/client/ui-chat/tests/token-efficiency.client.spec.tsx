// @vitest-environment jsdom
/**
 * The Efficiency rail entry and its redesigned token-efficiency window:
 * anchor tiles (spend, median, pooled average, max), the token-mix bar,
 * the rate column and the three anchored multiple columns, the parent
 * ladder, the unpriced empty state, and the rail/wide forms.
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
  efficiencyAnchors, efficiencyReading, formatMultiple, mixPercents, multipleBand,
  orderEfficiencyReadings, perMillionMicros, type EfficiencyReading,
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
function row(id: string, title: string, parentId: string | undefined, sessionCost: SessionCostProjection | undefined, updatedAt = 0): {
  id: string
  displayTitle: string
  running: boolean
  blank: boolean
  updatedAt: number
  parentId?: string
  projectionValues?: { sessionCost: SessionCostProjection }
} {
  return {
    id, displayTitle: title, running: false, blank: false, updatedAt,
    ...(parentId === undefined ? {} : { parentId }),
    ...(sessionCost === undefined ? {} : { projectionValues: { sessionCost } }),
  }
}

/** The reference listing from the approved mock, with internally consistent folds. */
function pricedRows() {
  return {
    audit: row('audit', 'Nightly audit sweep', undefined, cost(2_360_000, {
      qwen: { buckets: [940_000, 0, 60_000, 0], micros: 2_360_000 },
    }), 30),
    refactor: row('refactor', 'Refactor auth to session-stats', undefined, cost(3_700_000, {
      'qwen3.8-max': { buckets: [550_000, 0, 2_250_000, 0], micros: 3_500_000 },
      'deepseek-v4': { buckets: [0, 0, 2_200_000, 0], micros: 200_000 },
    }), 20),
    act: row('act', 'act: apply migration', 'refactor', cost(950_000, {
      qwen: { buckets: [130_000, 0, 370_000, 0], micros: 950_000 },
    }), 21),
    explore: row('explore', 'explore: repo orientation', 'refactor', cost(150_000, {
      v4: { buckets: [80_000, 0, 920_000, 0], micros: 150_000 },
    }), 22),
    deep: row('deep', 'explore: deep dive', 'explore', cost(20_000, {
      v4: { buckets: [50_000, 0, 50_000, 0], micros: 20_000 },
    }), 1),
    docs: row('docs', 'Docs Q&A', undefined, cost(1_360_000, {
      a: { buckets: [100_000, 0, 1_000_000, 0], micros: 400_000 },
      b: { buckets: [100_000, 0, 1_000_000, 0], micros: 500_000 },
      c: { buckets: [180_000, 0, 1_320_000, 0], micros: 460_000 },
    }), 40),
    v4only: row('v4only', 'Refactor auth (v4 only)', undefined, cost(630_000, {
      v4: { buckets: [675_000, 0, 3_825_000, 0], micros: 630_000 },
    }), 10),
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

/** Column N's cell texts over the visible body rows. */
function column(dialog: HTMLElement, index: number): string[] {
  return [...dialog.querySelectorAll(`tbody td:nth-child(${index})`)].map(td => td.textContent)
}

describe('cost metrics', () => {
  const reading = (id: string, rate: number | null, parentId: string | null = null, updatedAt = 0): EfficiencyReading => ({
    id,
    title: id,
    parentId,
    updatedAt,
    costMicros: rate ?? 0,
    tokens: 1,
    rateMicros: rate,
    cacheHit: null,
    models: 1,
    spendEntries: [],
    mix: { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 1 },
  })

  it('blends micros over tokens and refuses an unbilled fold', () => {
    expect(perMillionMicros(1_000_000, 1_000_000)).toBe(1_000_000)
    expect(perMillionMicros(500_000, 1_000_000)).toBe(500_000)
    expect(perMillionMicros(500_000, 0)).toBeNull()
  })

  it('splits a fold into mix percents and nulls the unbilled mix', () => {
    expect(mixPercents({ uncached: 1, cacheRead: 1, cacheWrite: 1, output: 1 }, 4)).toEqual([25, 25, 25, 25])
    expect(mixPercents({ uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, 0)).toBeNull()
  })

  it('prints multiples whole above ten and one decimal below, banded by distance', () => {
    expect(formatMultiple(0.25)).toBe('0.3')
    expect(formatMultiple(1.4)).toBe('1.4')
    expect(formatMultiple(10.4)).toBe('10')
    expect(formatMultiple(11)).toBe('11')
    expect(multipleBand(0.9)).toBe('good')
    expect(multipleBand(1.999)).toBe('near')
    expect(multipleBand(2)).toBe('high')
  })

  it('ladders decoder rows under their roots by recency, roots latest first', () => {
    const ordered = orderEfficiencyReadings([
      reading('cheap', 1, null, 1),
      reading('child', 9, 'dear', 4),
      reading('dear', 5, null, 3),
      reading('orphan', 3, 'gone', 2),
    ])
    // dear (newest root) leads with its child beneath; the orphan and the
    // cheap root follow in recency order, the child's higher rate ignored.
    expect(ordered.map(r => [r.id, r.depth])).toEqual([
      ['dear', 0], ['child', 1], ['orphan', 0], ['cheap', 0],
    ])
  })

  it('cuts a pure parent cycle instead of looping', () => {
    // The chain walk visits each member once: the newest cycle node
    // becomes the ladder root and the follower rides one rung beneath.
    const ordered = orderEfficiencyReadings([reading('a', 2, 'b', 2), reading('b', 1, 'a', 1)])
    expect(ordered.map(r => [r.id, r.depth])).toEqual([['a', 0], ['b', 1]])
  })

  it('anchors on the pooled money average, the median family rate, and the max', () => {
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
    const anchors = efficiencyAnchors(ordered)
    // Pooled micros over family tokens, divided once; never rate averages.
    expect(anchors.average).toMatchObject({ micros: 4_200_000, tokens: 3_000_000, rate: 1_400_000, sessions: 3 })
    // The middle of the sorted family rates; the top is the max anchor.
    expect(anchors.median).toBe(1_000_000)
    expect(anchors.max).toBe(3_000_000)
    expect(anchors.priced).toBe(3)
  })

  it('means the middle two family rates on an even family count', () => {
    const ordered = orderEfficiencyReadings([
      reading('a', 1), reading('b', 3), reading('c', 5), reading('d', 7),
    ])
    expect(efficiencyAnchors(ordered).median).toBe(4_000_000)
  })

  it('rolls a session family over root plus subagent tree', () => {
    const asSummary = (summaryRow: ReturnType<typeof row>): SessionSummary =>
      summaryRow as unknown as SessionSummary
    const rows = pricedRows()
    const ordered = orderEfficiencyReadings([
      efficiencyReading('refactor', asSummary(rows.refactor), rows.refactor.projectionValues!.sessionCost),
      efficiencyReading('act', asSummary(rows.act), rows.act.projectionValues!.sessionCost),
      efficiencyReading('explore', asSummary(rows.explore), rows.explore.projectionValues!.sessionCost),
    ])
    const family = ordered.find(r => r.id === 'refactor')!.family!
    // Four distinct models across the tree, pooled spend per model.
    expect(family.models).toBe(4)
    expect(family.micros).toBe(4_800_000)
    expect(family.tokens).toBe(6_500_000)
    expect(family.entries.map(([model]) => model)).toEqual(['qwen3.8-max', 'qwen', 'deepseek-v4', 'v4'])
    // The family mix pools every billed bucket, output included.
    expect(family.mix).toEqual({ uncached: 760_000, cacheRead: 5_740_000, cacheWrite: 0, output: 0 })
    // Children carry no family; the root rows alone do.
    expect(ordered.find(r => r.id === 'act')!.family).toBeNull()
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

  it('shows the empty state with zeroed tiles when nothing is priced', () => {
    const view = mount({ audit: row('audit', 'Nightly audit sweep', undefined, undefined) })
    const dialog = open(view)
    expect(dialog.getAttribute('aria-label')).toBe('Token efficiency')
    // Portaled beside the RTL container, not inside it.
    expect(document.body.contains(dialog)).toBe(true)
    expect(view.container.contains(dialog)).toBe(false)
    expect(dialog.textContent).toContain('No priced sessions yet')
    expect(dialog.querySelector('table')).toBeNull()
    // The tiles stay, named at zero, so the anchors remain findable.
    expect(dialog.textContent).toContain('Median · typical')
    expect(dialog.textContent).toContain('$0.00/M tok')
  })

  it('nests subagent rows recursively under expanded ancestors only', () => {
    const view = mount(pricedRows())
    const dialog = open(view)
    const refactorCaret = view.getByRole('button', { name: 'Expand Refactor auth to session-stats' })
    const exploreCaret = () => view.getByRole('button', { name: 'Expand explore: repo orientation' })
    // The grandchild stays hidden while its own parent is folded, even
    // after the root unfolds one level.
    fireEvent.click(refactorCaret)
    expect(column(dialog, 1).map(text => text)).not.toContain('explore: deep dive')
    fireEvent.click(exploreCaret())
    const titles = column(dialog, 1)
    expect(titles.indexOf('↳ ↳ explore: deep dive')).toBe(titles.indexOf('↳ explore: repo orientation') + 1)
    // Folding the root folds the whole subtree, expanded child included.
    fireEvent.click(refactorCaret)
    expect(column(dialog, 1)).not.toContain('↳ ↳ explore: deep dive')
  })

  it('lists session families latest first with mix, rate, multiples, and details per row', () => {
    const view = mount(pricedRows())
    const dialog = open(view)
    // Anchor tiles: pooled spend and tokens, median, pooled rate, max.
    expect(dialog.textContent).toContain('$9.17 · 15.8M')
    expect(dialog.textContent).toContain('Median · typical$0.549/M tok')
    expect(dialog.textContent).toContain('Avg · pooled$0.580/M tok')
    expect(dialog.textContent).toContain('Max · worst chat$2.36/M tok')
    // Collapsed by default: the four roots only.
    expect(column(dialog, 1)).toEqual([
      'Docs Q&A',
      'Nightly audit sweep',
      'Refactor auth to session-stats',
      'Refactor auth (v4 only)',
    ])
    // Expanding the refactor family ladders its subagent rows beneath it.
    const caret = view.getByRole('button', { name: 'Expand Refactor auth to session-stats' })
    fireEvent.click(caret)
    expect(caret.getAttribute('aria-expanded')).toBe('true')
    expect(column(dialog, 1)).toEqual([
      'Docs Q&A',
      'Nightly audit sweep',
      'Refactor auth to session-stats',
      '↳ explore: repo orientation',
      '↳ act: apply migration',
      'Refactor auth (v4 only)',
    ])
    // The rate column states each row's blended $/M-tok figure.
    expect(column(dialog, 3)).toEqual(['$0.368', '$2.36', '$0.730', '$0.150', '$1.90', '$0.140'])
    // The three multiple columns divide that rate by the three anchors.
    expect(column(dialog, 4)).toEqual(['×0.7', '×4.3', '×1.3', '×0.3', '×3.5', '×0.3'])
    expect(column(dialog, 5)).toEqual(['×0.6', '×4.1', '×1.3', '×0.3', '×3.3', '×0.2'])
    expect(column(dialog, 6)).toEqual(['×0.2', '×1', '×0.3', '×0.1', '×0.8', '×0.1'])
    // Detail columns: cache hit, spend, tokens, models.
    expect(column(dialog, 7)).toEqual(['90%', '6%', '88%', '92%', '74%', '85%'])
    expect(column(dialog, 8)).toEqual(['$1.36', '$2.36', '$4.82', '$0.150', '$0.950', '$0.630'])
    expect(column(dialog, 9)).toEqual(['3.7M', '1M', '6.6M', '1M', '500K', '4.5M'])
    expect(column(dialog, 10)).toEqual(['3', '1', '4', '1', '1', '1'])
    fireEvent.click(caret)
    expect(caret.getAttribute('aria-expanded')).toBe('false')
    expect(column(dialog, 1)).toHaveLength(4)
  })

  it('names the anchor dollars when a multiple chip is hovered', () => {
    const view = mount(pricedRows())
    const dialog = open(view)
    // Collapsed roots latest first: docs 0, audit 1, refactor 2, v4only 3.
    const refactorMedianChip = dialog.querySelectorAll('tbody tr')[2]!.querySelector('td:nth-child(4) span')!
    fireEvent.mouseOver(refactorMedianChip)
    const tip = view.getByRole('tooltip')
    expect(tip.textContent).toBe('vs median — $0.730/M tok ÷ $0.549/M tok')
    fireEvent.mouseOut(refactorMedianChip)
    expect(view.queryByRole('tooltip')).toBeNull()
  })

  it('splits each row into its billed token mix on hover', () => {
    const view = mount(pricedRows())
    const dialog = open(view)
    const docsMix = dialog.querySelector('tbody td:nth-child(2) span[tabindex]')!
    fireEvent.mouseOver(docsMix)
    expect(view.getByRole('tooltip').textContent)
      .toBe('uncached 10% · cache read 90% · cache write 0% · output 0%')
    fireEvent.mouseOut(docsMix)
    expect(view.queryByRole('tooltip')).toBeNull()
  })

  it('prints whole multiples above ten', () => {
    const rows = {
      ...pricedRows(),
      spike: row('spike', 'spike: reroll everything', 'audit', cost(1_200_000, {
        qwen: { buckets: [200_000, 0, 0, 0], micros: 1_200_000 },
      }), 31),
    }
    const view = mount(rows)
    const dialog = open(view)
    fireEvent.click(view.getByRole('button', { name: 'Expand Nightly audit sweep' }))
    const spike = column(dialog, 1).indexOf('↳ spike: reroll everything')
    const chips = dialog.querySelectorAll('tbody tr')[spike]!
    expect(chips.querySelector('td:nth-child(4)')!.textContent).toBe('×11')
    expect(chips.querySelector('td:nth-child(5)')!.textContent).toBe('×9.3')
    expect(chips.querySelector('td:nth-child(6)')!.textContent).toBe('×2')
  })

  it('opens the per-model listing when the Models cell is hovered', () => {
    const view = mount(pricedRows())
    const dialog = open(view)
    const mixedCell = [...dialog.querySelectorAll('tbody td:nth-child(10) span')][2]!
    fireEvent.mouseOver(mixedCell)
    const tip = view.getByRole('tooltip')
    expect(tip.textContent).toContain('Refactor auth to session-stats · 4 model(s) logged')
    expect(tip.textContent).toContain('qwen3.8-max — $3.50 · 2.8M')
    expect(tip.textContent).toContain('qwen — $0.950 · 500K')
    expect(tip.textContent).toContain('deepseek-v4 — $0.200 · 2.2M')
    fireEvent.mouseOut(mixedCell)
    expect(view.queryByRole('tooltip')).toBeNull()
  })

  it('closes on Escape and on mask click, restoring trigger focus', () => {
    const view = mount(pricedRows())
    const trigger = view.getByRole('button', { name: 'Efficiency' })
    fireEvent.click(trigger)
    expect(view.getByRole('dialog')).toBeTruthy()
    // Other keys pass through the handler without closing.
    fireEvent.keyDown(document, { key: 'a' })
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
    expect(dialog.textContent).toContain('相对中位')
    expect(dialog.textContent).toContain('中位 · 典型')
    expect(dialog.textContent).toContain('会话')
  })

  it('dashes the multiples and empties the mix of an unbilled fold', () => {
    const view = mount({
      zero: row('zero', 'Zero-token charge', undefined, cost(500_000, {
        m: { buckets: [0, 0, 0, 0], micros: 500_000 },
      })),
      zero2: row('zero2', 'Another zero', undefined, cost(200_000, {
        m: { buckets: [0, 0, 0, 0], micros: 200_000 },
      })),
    })
    const dialog = open(view)
    // No rate and no anchors: every multiple column prints the dash.
    expect(column(dialog, 4)).toEqual(['—', '—'])
    expect(column(dialog, 5)).toEqual(['—', '—'])
    expect(column(dialog, 6)).toEqual(['—', '—'])
    expect(column(dialog, 7)).toEqual(['', ''])
    expect(column(dialog, 9)).toEqual(['0', '0'])
    // The mix track renders empty, and carries no hover.
    expect(dialog.querySelectorAll('tbody td:nth-child(2) span[aria-hidden="true"]')).toHaveLength(2)
    expect(dialog.querySelectorAll('tbody td:nth-child(2) span[tabindex]')).toHaveLength(0)
  })

  it('names the unlogged model in the per-model listing', () => {
    const view = mount({ odd: row('odd', 'Odd fold', undefined, cost(100_000, {
      '': { buckets: [10_000, 0, 0, 0], micros: 100_000 },
    })) })
    const dialog = open(view)
    const cell = dialog.querySelector('tbody td:nth-child(10) span')!
    fireEvent.mouseOver(cell)
    expect(view.getByRole('tooltip').textContent).toContain('unlogged model — $0.100 · 10K')
    fireEvent.mouseOut(cell)
  })
})
