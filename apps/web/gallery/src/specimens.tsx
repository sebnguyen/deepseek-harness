import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CompactionNodeView, ContextMessageNodeView, RetryNodeView, TurnErrorNodeView,
  TurnMaxTokensNodeView, UnknownNodeView, UserMessageNodeView,
} from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/MessageItem.tsx'
import { AssistantNodeView } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/AssistantNodeView.tsx'
import { CommandNodeView, ManualCompactionNodeView } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/CommandNodeView.tsx'
import { SystemPromptNodeView } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/SystemPromptRow.tsx'
import { TurnTailNodeView } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/TurnTailNodeView.tsx'
import { DiffBlock, PixelLoader, ReadBlock, TerminalBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import { ToolCallTree } from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/ToolCallTree.tsx'
import { GoalCommandInputView } from '@deepseek-ai/dsh-client-ui-goal/src/client/GoalCommandInputView.tsx'
import { WorkflowRunPanel } from '@deepseek-ai/dsh-client-ui-workflow-run/src/client/WorkflowRunPanel.tsx'
import {
  assistantMessage, baseProps, commandNode, contextMessage, node, renderToolSlot,
  resultBlock, runningBlock, runningTool, steeringMessage, toolNode, toolResult,
  userMessage,
} from './harness.tsx'

export interface Variant {
  readonly label: string
  readonly render: () => ReactNode
}

export interface Specimen {
  readonly id: string
  readonly group: 'chat' | 'tool' | 'lifecycle' | 'extension'
  readonly kind: string
  readonly component: string
  readonly title: string
  readonly blurb: string
  readonly variants: readonly Variant[]
  readonly note?: string
}

const prompt = node('system-prompt', {
  text: '# Agent rules\n\n- Read the repository before you edit.\n- Keep the change focused.\n- Run the checks that prove the change.',
})

const turnLocation = {
  turn: 1,
  status: 'closed',
  start: { type: 'turn/start', seq: 1, time: Date.now() - 8_400 },
  end: { type: 'turn/end', seq: 20, time: Date.now() },
  steps: [],
  data: {
    get: () => undefined,
    source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
  },
}

const closingBlocks = [{ kind: 'text' as const, text: 'The gallery now mounts the real chat node views and their CSS modules.' }]
const closingTime = Date.now() - 400
const turnTail = node('turn-tail', {
  turn: 1,
  seq: 20,
  time: Date.now(),
  closing: {
    status: 'settled',
    turn: 1,
    step: 2,
    blocks: closingBlocks,
    time: closingTime,
    finalNode: {
      kind: 'assistant',
      messageId: 'message-closing',
      seq: 19,
      time: closingTime,
      turn: 1,
      step: 2,
      blocks: closingBlocks,
    },
  },
  branchUnavailable: false,
  ttftMs: 420,
  tokensPerSecond: 56.2,
  tokenUsage: {
    uncachedInputTokens: 10_400,
    outputTokens: 1_920,
    totalTokens: 12_320,
    cacheReadTokens: 10_000,
    routes: [{ provider: 'deepseek', model: 'deepseek-v4.1' }],
  },
}, { kind: 'turn', turn: turnLocation })

const turnTailChat = (selector: (snapshot: unknown) => unknown) => selector({
  locations: { getTurn: () => [turnTail.key] },
})

const compaction = {
  kind: 'compaction' as const,
  seq: 8,
  time: Date.now() - 22_000,
  summary: 'The conversation was compacted at the tool boundary.\n\nThe agent kept the current task, the changed files, and the open decisions.',
  summaryEventSeq: 7,
  shadowedItemCount: 18,
  shadowedTokenCount: 21_400,
}

const manualCompaction = {
  command: {
    kind: 'command' as const,
    seq: 9,
    time: Date.now() - 20_000,
    commandId: 'manual-compact-1',
    name: 'compact',
    args: '',
    outcome: { kind: 'success' as const, text: 'Context compacted.' },
  },
  compaction,
}

const retry = {
  kind: 'model-retry' as const,
  retryId: 'retry-gallery',
  seq: 11,
  time: Date.now() - 12_000,
  retryState: 'scheduled' as const,
  turn: 1,
  step: 0,
  provider: 'deepseek',
  mode: 'normal' as const,
  policyKey: 'deepseek-normal',
  retry: 1,
  maxRetries: 2,
  delayMs: 2_500,
  failure: { code: 'TRANSPORT', message: 'Connection reset by peer.' },
}

const turnError = {
  kind: 'turn-error' as const,
  seq: 13,
  time: Date.now() - 9_000,
  turn: 1,
  step: 3,
  message: 'The provider returned 429 after three attempts.',
  code: 'RATE_LIMIT',
}

const maxTokens = {
  kind: 'turn-max-tokens' as const,
  seq: 14,
  time: Date.now() - 8_000,
  turn: 1,
  step: 4,
}

const unknown = node('unknown', {
  type: 'future/surface',
  data: { event: 'future/surface', payload: { note: 'A surface this UI version does not know.' } },
})

/** The one-line boundary renderer registered by ui-chat; it deliberately paints nothing. */
const DeclinedStepBoundaryView = (): null => null

function toolCard(root: unknown): ReactNode {
  return <ToolCallTree node={toolNode(root)} {...baseProps} renderSlot={renderToolSlot as never} />
}

function shell(props: { children: ReactNode; className?: string }): ReactNode {
  return <>{props.children}</>
}

export type Rule3Tool = 'read' | 'write' | 'bash' | 'generic'
export type ExtraPixelMark =
  | 'model-provider' | 'pause' | 'send' | 'adjust' | 'setting' | 'attach' | 'add'
  | 'quiet-mode' | 'narrate-mode' | 'thumb-down' | 'thumb-up' | 'clock' | 'token'
  | 'todo' | 'ask' | 'image-read' | 'fork' | 'copy' | 'reload' | 'internet'
  | 'folder-add' | 'folder-close' | 'folder-open' | 'statistic' | 'error'
export type PixelMark = Rule3Tool | 'think' | 'context' | ExtraPixelMark
export type Rule3Tone = 'ok' | 'error' | 'running'

interface Rule3ReadPreview {
  readonly kind: 'read'
  readonly lines: readonly { readonly number: number; readonly text: string }[]
  readonly totalLines: number
  readonly lang?: string
}

interface Rule3DiffPreview {
  readonly kind: 'diff'
  readonly oldText: string | null
  readonly newText: string
}

interface Rule3TerminalPreview {
  readonly kind: 'terminal'
  readonly output: string
  readonly running?: boolean
}

interface Rule3ErrorPreview {
  readonly kind: 'error'
  readonly message: string
}

type Rule3Preview = Rule3ReadPreview | Rule3DiffPreview | Rule3TerminalPreview | Rule3ErrorPreview

export interface Rule3Row {
  readonly primary: string
  readonly state: string
  readonly detail: string
  readonly tone: Rule3Tone
  readonly preview: Rule3Preview
}

function rule3RowKey(row: Rule3Row): string {
  return `${row.primary}::${row.state}`
}

function rule3TabState(rows: readonly Rule3Row[]): string {
  const missing = rows.filter(row => row.state === 'Missing').length
  if (missing > 0) return `${missing} missing`
  const failed = rows.filter(row => row.tone === 'error').length
  if (failed > 0) return `${failed} failed`
  const running = rows.filter(row => row.tone === 'running').length
  if (running > 0) return `${running} running`
  return `${rows.length} done`
}

interface Rule3Example {
  readonly id: Rule3Tool
  readonly title: string
  readonly count: string
  readonly columns: readonly string[]
  readonly rows: readonly Rule3Row[]
}

/*
 * The supplied Read, Write, Bash and Generic SVGs, pixelized to the 16×16 grid.
 * Each cell renders at 0.8 with a 0.1 inset so the mark keeps the same 20% gaps.
 */
const RULE3_PIXEL_ROWS: Record<PixelMark, readonly string[]> = {
  read: [
    '................', '..########......', '..##.....##.....', '..#......###....',
    '..#......####...', '..#......#####..', '..#..........#..', '..#..........#..',
    '..#..######..#..', '..#..........#..', '..#..........#..', '..#..######..#..',
    '..#..........#..', '..##........##..', '..############..', '................',
  ],
  write: [
    '................', '...........##...', '..........####..', '.........#####..',
    '........######..', '.......##..##...', '......##..##....', '.....##..##.....',
    '....##..##......', '...##..##.......', '..##..##........', '.##..##.........',
    '.#..##..........', '.####...#######.', '.###...########.', '................',
  ],
  bash: [
    '................', '.##############.', '.##..........##.', '.#............#.',
    '.#............#.', '.#....#..#....#.', '.#...##..##...#.', '.#..##....##..#.',
    '.#..##....##..#.', '.#...##..##...#.', '.#....#..#....#.', '.#............#.',
    '.#............#.', '.##..........##.', '.##############.', '................',
  ],
  generic: [
    '................', '.....###...##...', '....####..##....', '...####...##..#.',
    '..#####...#####.', '.#######.######.', '.############...', '..##..#####.....',
    '......####......', '.....####.##....', '....####.####...', '...####...####..',
    '..####.....####.', '.####.......###.', '..##.........#..', '................',
  ],
  think: [
    '................', '......#..#......', '....########....', '...##########...',
    '..##........##..', '..##........##..', '.###..####..###.', '..##..#..#..##..',
    '..##..#..#..##..', '.###..####..###.', '..##........##..', '..##........##..',
    '...##########...', '....########....', '......#..#......', '................',
  ],
  context: [
    '................', '..########......', '..##.....##.....', '..#......###....',
    '..#......####...', '..#......#####..', '..#..........#..', '..#....##....#..',
    '..#....##....#..', '..#..######..#..', '..#....##....#..', '..#....##....#..',
    '..#..........#..', '..##........##..', '..############..', '................',
  ],
  'model-provider': [
    '.......##.......', '.......###......', '......#####.....', '....#######.....',
    '...###.###..#...', '..##...##...##..', '.###........###.', '.##...####...##.',
    '.##..######..##.', '.##..######..##.', '.##..######..##.', '.##...####...##.',
    '.##...####...##.', '..##...##...##..', '................', '.......##.......',
  ],
  'pause': [
    '#######..#######', '#######..#######', '##...##..##...##', '##...##..##...##',
    '##...##..##...##', '##...##..##...##', '##...##..##...##', '##...##..##...##',
    '##...##..##...##', '##...##..##...##', '##...##..##...##', '##...##..##...##',
    '##...##..##...##', '##...##..##...##', '#######..#######', '#######..#######',
  ],
  'send': [
    '.......##.......', '......####......', '.....######.....', '....########....',
    '...##########...', '..###..##..###..', '.###...##...###.', '###....##....###',
    '##.....##.....##', '.......##.......', '.......##.......', '.......##.......',
    '.......##.......', '.......##.......', '.......##.......', '.......##.......',
  ],
  'adjust': [
    '...........##...', '...........##...', '#########..#####', '#########..#####',
    '...........##...', '....#...........', '...##...........', '#####..#########',
    '#####..#########', '...##...........', '....#...........', '.......##.......',
    '#####..#########', '#####..#########', '.......##.......', '.......##.......',
  ],
  'setting': [
    '......####......', '.....######.....', '..##.##..##.##..', '.######..######.',
    '.#####....#####.', '###...####...###', '####.######.####', '..##.######.##..',
    '..##.######.##..', '####.######.####', '###...####...###', '.#####....#####.',
    '.######..######.', '..##.##..##.##..', '.....######.....', '......####......',
  ],
  'attach': [
    '.....####.......', '....######......', '...##...##......', '...##.#.##.##...',
    '...##.#..#.##...', '...##.#..#.##...', '...##.#..#.##...', '...##.#..#.##...',
    '...##.#..#.##...', '...##.#..#.##...', '...##.####.##...', '...##.####.##...',
    '...##..##..##...', '....##....##....', '....########....', '......####......',
  ],
  'add': [
    '.......##.......', '.......##.......', '.......##.......', '.......##.......',
    '.......##.......', '.......##.......', '.......##.......', '################',
    '################', '.......##.......', '.......##.......', '.......##.......',
    '.......##.......', '.......##.......', '.......##.......', '.......##.......',
  ],
  'quiet-mode': [
    '................', '.........#......', '........##......', '.......###......',
    '......####..#...', '.#########..##..', '.######.##..###.', '.##.....##..###.',
    '.##.....##..###.', '.######.##..###.', '.#########..##..', '......####..#...',
    '.......###......', '........##......', '.........#......', '................',
  ],
  'narrate-mode': [
    '..........#.....', '.......#..###...', '......##...###..', '.....###....###.',
    '....####.....##.', '########..#...##', '#####.##..##..##', '##....##..##..##',
    '##....##..##..##', '#####.##..##..##', '########..#...##', '....####.....##.',
    '.....###....###.', '......##...###..', '.......#..###...', '..........#.....',
  ],
  'thumb-down': [
    '...#############', '..##############', '..##......##..##', '.##.......##..##',
    '.##.......##..##', '##........##..##', '##........##..##', '##........##..##',
    '##........###.##', '########..######', '..######..######', '......##.##.....',
    '......####......', '.....####.......', '......##........', '................',
  ],
  'thumb-up': [
    '................', '........##......', '.......####.....', '......####......',
    '.....##.##......', '...###..##......', '######..########', '##.###........##',
    '##..##........##', '##..##........##', '##..##........##', '##..##.......##.',
    '##..##.......##.', '##..##......##..', '##############..', '#############...',
  ],
  'clock': [
    '.....######.....', '...##########...', '..###......###..', '.###........###.',
    '.##....##....##.', '##.....##.....##', '##.....##.....##', '##.....##.....##',
    '##.....###....##', '##......###...##', '##.......###..##', '.##.......#..##.',
    '.###........###.', '..###......###..', '...##########...', '.....######.....',
  ],
  'token': [
    '....########....', '..############..', '####........####', '##............##',
    '###..........###', '################', '##..########..##', '##............##',
    '##............##', '#####......#####', '################', '##.....##.....##',
    '##............##', '###..........###', '.##############.', '....########....',
  ],
  'todo': [
    '................', '................', '##########......', '##########......',
    '................', '................', '##########......', '##########......',
    '..............##', '#######......##.', '#######.###.##..', '.........####...',
    '..........##....', '................', '................', '................',
  ],
  'ask': [
    '......####......', '....########....', '..####....####..', '.###........###.',
    '.##...####...##.', '.##...#..#...##.', '.##......#...##.', '.##.....##...##.',
    '..#....##....#..', '..##........##..', '..##...##...##..', '..###..##..###..',
    '...##......##...', '....###..###....', '.....######.....', '......####......',
  ],
  'image-read': [
    '................', '.#######....##..', '########...####.', '##........######',
    '##..........##..', '##..........##..', '##..........#...', '##..............',
    '##...........#..', '##......##...#..', '##..##.####..#..', '##.########..#..',
    '##...........#..', '##...........#..', '##############..', '.############...',
  ],
  'fork': [
    '..........######', '..........######', '............####', '...........#####',
    '..........###.##', '.........###..##', '........###.....', '##########......',
    '#########.......', '..........#.....', '.........###..##', '..........###.##',
    '...........#####', '............####', '..........######', '..........######',
  ],
  'copy': [
    '.....#########..', '....###########.', '....##.......##.', '.##.##.......##.',
    '.##.##.......##.', '.##.##.......##.', '.##.##.......##.', '.##.##.......##.',
    '.##.##.......##.', '.##.##.......##.', '.##.##.......##.', '.##.###########.',
    '.##..#########..', '.##.............', '.##########.....', '..##########....',
  ],
  'reload': [
    '.....######...##', '...##########.##', '..####....######', '.###........####',
    '.##..........###', '###......#######', '##.......#######', '##..............',
    '##..............', '##..............', '###..........###', '.##..........##.',
    '.###........###.', '..####....####..', '...##########...', '.....######.....',
  ],
  'internet': [
    '......####......', '....########....', '..########.###..', '..########...#..',
    '.######......##.', '.######.......#.', '#####.........##', '##.##.........##',
    '##..######....##', '##...#####....##', '.#....####....#.', '.##...######.##.',
    '.##....#######..', '..###..#######..', '....########....', '......####......',
  ],
  'folder-add': [
    '................', '...######.......', '...############.', '...#....########',
    '##.#..........##', '##.#..........##', '##.#..........##', '##.#..........##',
    '##.#..........##', '##.#..........##', '##.#############', '##.#############',
    '##..............', '##############..', '##############..', '................',
  ],
  'folder-close': [
    '................', '.#####..........', '#######.........', '##....#########.',
    '##.....#########', '##............##', '##............##', '##............##',
    '##............##', '##............##', '##............##', '##............##',
    '##............##', '################', '.##############.', '................',
  ],
  'folder-open': [
    '................', '................', '#######.........', '##############..',
    '##....#########.', '##..............', '##.#############', '##.#############',
    '##.#..........##', '####.........##.', '####.........##.', '###..........##.',
    '##############..', '##############..', '................', '................',
  ],
  'statistic': [
    '.##############.', '################', '##............##', '##............##',
    '##.....##.....##', '##.....##.....##', '##..#..##.....##', '##.##..##.....##',
    '##.##..##.....##', '##.##..##..##.##', '##.##..##..##.##', '##.##..##..##.##',
    '##..#......#..##', '##............##', '################', '.##############.',
  ],  'error': [
    '....########....', '...##########...', '..###......###..', '.###........###.',
    '###..#....#..###', '##..###..###..##', '##...######...##', '##....####....##',
    '##....####....##', '##...######...##', '##..###..###..##', '###..#....#..###',
    '.###........###.', '..###......###..', '...##########...', '....########....',
  ],

}

function pixelCells(rows: readonly string[]): readonly (readonly [number, number])[] {
  return rows.flatMap((row, y) => [...row].flatMap((cell, x) => cell === '#' ? [[x, y] as const] : []))
}

const RULE3_PIXEL_CELLS = Object.fromEntries(
  Object.entries(RULE3_PIXEL_ROWS).map(([tool, rows]) => [tool, pixelCells(rows)]),
) as Record<PixelMark, readonly (readonly [number, number])[]>

function tightViewBox(cells: readonly (readonly [number, number])[]): string {
  const xs = cells.map(([x]) => x)
  const ys = cells.map(([, y]) => y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const width = Math.max(...xs) - minX + 1
  const height = Math.max(...ys) - minY + 1
  return `${minX} ${minY} ${width} ${height}`
}

const RULE3_PIXEL_VIEWBOX = Object.fromEntries(
  Object.entries(RULE3_PIXEL_CELLS).map(([tool, cells]) => [tool, tightViewBox(cells)]),
) as Record<PixelMark, string>

export function Rule3ToolIcon({ tool, className }: { readonly tool: PixelMark; readonly className?: string }): ReactNode {
  return (
    <svg
      className={`rule3-tool-svg${className ? ` ${className}` : ''}`}
      viewBox={RULE3_PIXEL_VIEWBOX[tool]}
      aria-hidden="true"
      focusable="false"
    >
      {RULE3_PIXEL_CELLS[tool].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 0.1} y={y + 0.1} width={0.8} height={0.8} rx={0.1} />
      ))}
    </svg>
  )
}

/* The supplied bounded check and cross, pixelized to the same 16×16 grid. */
const RULE3_CHECK_ROWS: readonly string[] = [
  '................', '................', '................', '.............#..',
  '............###.', '...........###..', '..........###...', '..#......###....',
  '.###....###.....', '..###..###......', '...######.......', '....####........',
  '.....##.........', '................', '................', '................',
]

const RULE3_CROSS_ROWS: readonly string[] = [
  '................', '..#..........#..', '.###........###.', '..###......###..',
  '...###....###...', '....###..###....', '.....######.....', '......####......',
  '......####......', '.....######.....', '....###..###....', '...###....###...',
  '..###......###..', '.###........###.', '..#..........#..', '................',
]

const RULE3_CHECK_CELLS = pixelCells(RULE3_CHECK_ROWS)
const RULE3_CROSS_CELLS = pixelCells(RULE3_CROSS_ROWS)

export function Rule3StatusIcon({ tone }: { readonly tone: Rule3Tone }): ReactNode {
  if (tone === 'running') {
    return (
      <span className="rule3-status rule3-status-running">
        <PixelLoader size={8} mode="sweep" className="rule3-loader-svg" />
      </span>
    )
  }
  const cells = tone === 'ok' ? RULE3_CHECK_CELLS : RULE3_CROSS_CELLS
  return (
    <span className={`rule3-status rule3-status-${tone}`}>
      <svg className="rule3-status-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {cells.map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x + 0.1} y={y + 0.1} width={0.8} height={0.8} rx={0.1} />
        ))}
      </svg>
    </span>
  )
}

const RULE3_CLOSE_ROWS: readonly string[] = [
  '................', '.....######.....', '....###..###....', '...##......##...',
  '..##........##..', '.##..#....#..##.', '.##...#..#...##.', '.#.....##.....#.',
  '.#.....##.....#.', '.##...#..#...##.', '.##..#....#..##.', '..##........##..',
  '...##......##...', '....###..###....', '.....######.....', '................',
]

const RULE3_CLOSE_CELLS = pixelCells(RULE3_CLOSE_ROWS)

export function Rule3CloseIcon(): ReactNode {
  return (
    <svg className="rule3-close-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {RULE3_CLOSE_CELLS.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 0.1} y={y + 0.1} width={0.8} height={0.8} rx={0.1} />
      ))}
    </svg>
  )
}

const RULE3_READ_LABELS = {
  window: (shown: number, total: number) => `Showing ${shown} of ${total} lines`,
  copy: 'Copy',
  copied: 'Copied',
  collapseAria: 'Collapse read preview',
  expandAria: (hidden: number) => `Expand ${hidden} hidden lines`,
  collapse: 'Collapse',
  expand: (hidden: number) => `Show ${hidden} more lines`,
}

const RULE3_DIFF_LABELS = {
  copy: 'Copy',
  copied: 'Copied',
  collapseAria: 'Collapse diff preview',
  expandAria: (hidden: number) => `Expand ${hidden} hidden lines`,
  collapse: 'Collapse',
  expand: (hidden: number) => `Show ${hidden} more lines`,
  files: (count: number) => `${count} file${count === 1 ? '' : 's'}`,
}

const RULE3_TERMINAL_LABELS = {
  signal: (signal: string) => `signal ${signal}`,
  exitCode: (exitCode: number) => `exit ${exitCode}`,
  running: 'Running',
  failed: 'Failed',
  done: 'Passed',
  copy: 'Copy',
  copied: 'Copied',
  noOutput: 'No output',
  collapseAria: 'Collapse terminal preview',
  collapse: 'Collapse',
  expandAria: (hidden: number) => `Expand ${hidden} hidden lines`,
  expand: (hidden: number) => `Show ${hidden} more lines`,
}

export const RULE3_EXAMPLES: readonly Rule3Example[] = [
  {
    id: 'read',
    title: 'Read',
    count: '5 files',
    columns: ['State', 'File', 'Detail'],
    rows: [
      {
        primary: 'src/main.ts',
        state: 'Read',
        detail: '3 lines',
        tone: 'ok',
        preview: {
          kind: 'read',
          lang: 'ts',
          totalLines: 3,
          lines: [
            { number: 1, text: 'export function main() {' },
            { number: 2, text: '  return 1' },
            { number: 3, text: '}' },
          ],
        },
      },
      {
        primary: 'src/tool.ts',
        state: 'Read',
        detail: 'lines 12–14 of 14',
        tone: 'ok',
        preview: {
          kind: 'read',
          lang: 'ts',
          totalLines: 14,
          lines: [
            { number: 12, text: 'export function defineTool() {' },
            { number: 13, text: '  return 1' },
            { number: 14, text: '}' },
          ],
        },
      },
      {
        primary: 'src/theme.ts',
        state: 'Read',
        detail: 'lines 4–6 of 6',
        tone: 'ok',
        preview: {
          kind: 'read',
          lang: 'ts',
          totalLines: 6,
          lines: [
            { number: 4, text: "export const accent = '#4d6bfe'" },
            { number: 5, text: 'export const radius = 6' },
            { number: 6, text: '}' },
          ],
        },
      },
      {
        primary: 'src/util.ts',
        state: 'Read',
        detail: '5 lines',
        tone: 'ok',
        preview: {
          kind: 'read',
          lang: 'ts',
          totalLines: 5,
          lines: [
            { number: 1, text: 'export function clamp(n: number) {' },
            { number: 2, text: '  return Math.max(0, n)' },
            { number: 3, text: '}' },
          ],
        },
      },
      {
        primary: 'src/missing.ts',
        state: 'Missing',
        detail: 'not found',
        tone: 'error',
        preview: { kind: 'error', message: 'ENOENT · src/missing.ts was not found in the workspace.' },
      },
    ],
  },
  {
    id: 'write',
    title: 'Write',
    count: '5 files',
    columns: ['State', 'File', 'Detail'],
    rows: [
      {
        primary: 'fixtures/a.txt',
        state: 'Created',
        detail: '+2',
        tone: 'ok',
        preview: { kind: 'diff', oldText: null, newText: 'hello\nworld\n' },
      },
      {
        primary: 'src/handler.ts',
        state: 'Edited',
        detail: '+1 −1',
        tone: 'ok',
        preview: {
          kind: 'diff',
          oldText: 'export function handler() { return 1 }\n',
          newText: 'export function handler() { return 2 }\n',
        },
      },
      {
        primary: 'src/theme.ts',
        state: 'Edited',
        detail: '+2 −1',
        tone: 'ok',
        preview: {
          kind: 'diff',
          oldText: "export const accent = '#3366ff'\n",
          newText: "export const accent = '#4d6bfe'\nexport const radius = 6\n",
        },
      },
      {
        primary: 'fixtures/b.txt',
        state: 'Created',
        detail: '+1',
        tone: 'ok',
        preview: { kind: 'diff', oldText: null, newText: 'done\n' },
      },
      {
        primary: 'locked.txt',
        state: 'Failed',
        detail: 'not read this session',
        tone: 'error',
        preview: { kind: 'error', message: 'EACCES · read locked.txt before writing it in this session.' },
      },
    ],
  },
  {
    id: 'bash',
    title: 'Bash',
    count: '5 commands',
    columns: ['State', 'Command', 'Detail'],
    rows: [
      {
        primary: 'pnpm lint',
        state: 'Passed',
        detail: '1.2s',
        tone: 'ok',
        preview: { kind: 'terminal', output: '✔ 12 files linted\n✔ no issues found' },
      },
      {
        primary: 'pnpm test',
        state: 'Passed',
        detail: '12.4s',
        tone: 'ok',
        preview: { kind: 'terminal', output: '✓ 53 tests passed\n✓ 0 failed' },
      },
      {
        primary: 'pnpm typecheck',
        state: 'Passed',
        detail: '3.2s',
        tone: 'ok',
        preview: { kind: 'terminal', output: '✓ no type errors' },
      },
      {
        primary: 'pnpm build',
        state: 'Running',
        detail: '—',
        tone: 'running',
        preview: { kind: 'terminal', running: true, output: '' },
      },
      {
        primary: 'pnpm format',
        state: 'Running',
        detail: '—',
        tone: 'running',
        preview: { kind: 'terminal', running: true, output: '' },
      },
    ],
  },
  {
    id: 'generic',
    title: 'Generic',
    count: '5 calls',
    columns: ['State', 'Call', 'Detail'],
    rows: [
      {
        primary: 'run_code',
        state: 'Passed',
        detail: 'verified 12 files',
        tone: 'ok',
        preview: { kind: 'terminal', output: 'verified 12 files' },
      },
      {
        primary: 'web_fetch',
        state: 'Passed',
        detail: '412ms',
        tone: 'ok',
        preview: { kind: 'terminal', output: 'fetched docs · 200 OK' },
      },
      {
        primary: 'web_search',
        state: 'Running',
        detail: '—',
        tone: 'running',
        preview: { kind: 'terminal', running: true, output: '' },
      },
      {
        primary: 'inspect_symbol',
        state: 'Running',
        detail: '—',
        tone: 'running',
        preview: { kind: 'terminal', running: true, output: '' },
      },
      {
        primary: 'run_code',
        state: 'Failed',
        detail: '2 files changed',
        tone: 'error',
        preview: { kind: 'error', message: 'verification failed: 2 files changed' },
      },
    ],
  },
]

function Rule3EmptyPreview({ tool }: { readonly tool: Rule3Tool }): ReactNode {
  return (
    <div className="rule3-preview-empty">
      <span className={`rule3-empty-pixel rule3-empty-${tool}`}><Rule3ToolIcon tool={tool} /></span>
      <p>Select a file or command.</p>
      <span>It opens the real read, diff or terminal view here.</span>
    </div>
  )
}

export function Rule3PreviewPanel(props: { readonly row: Rule3Row; readonly onClose: () => void }): ReactNode {
  const { row, onClose } = props
  const preview = row.preview
  const [copied, setCopied] = useState(false)
  const kind = preview.kind === 'read'
    ? 'Read preview'
    : preview.kind === 'diff'
      ? 'Diff preview'
      : preview.kind === 'terminal' ? 'Terminal preview' : 'Error'
  const copyValue = preview.kind === 'read'
    ? preview.lines.map(line => line.text).join('\n')
    : preview.kind === 'diff'
      ? preview.newText
      : preview.kind === 'terminal'
        ? [row.primary, preview.output].filter(Boolean).join('\n')
        : ''

  const onCopy = () => {
    if (copyValue.length === 0) return
    void navigator.clipboard.writeText(copyValue).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }).catch(() => undefined)
  }

  return (
    <div className="rule3-preview-inner" data-preview-kind={preview.kind}>
      <div className="rule3-preview-head">
        <span className="rule3-preview-kind">{kind}</span>
        <strong className="rule3-preview-path">{row.primary}</strong>
        <span className="rule3-preview-state"><span className="rule3-preview-dot" aria-hidden="true">·</span>{row.state}</span>
        <span className="rule3-preview-actions">
          {preview.kind !== 'error'
            ? <button type="button" className="rule3-preview-action" onClick={onCopy} aria-label={`Copy ${row.primary}`}>{copied ? 'Copied' : 'Copy'}</button>
            : null}
          <button type="button" className="rule3-preview-close" onClick={onClose} aria-label="Close preview"><Rule3CloseIcon /></button>
        </span>
      </div>
      {preview.kind === 'read'
        ? (
          <ReadBlock
            lines={preview.lines}
            totalLines={preview.totalLines}
            lang={preview.lang}
            labels={RULE3_READ_LABELS}
            maxLines={8}
            className="rule3-real-preview rule3-flat-preview"
          />
        )
        : preview.kind === 'diff'
          ? (
            <DiffBlock
              diffs={[{ path: row.primary, oldText: preview.oldText, newText: preview.newText }]}
              labels={RULE3_DIFF_LABELS}
              maxLines={8}
              className="rule3-real-preview rule3-flat-preview"
            />
          )
          : preview.kind === 'terminal'
            ? (
              <TerminalBlock
                command={row.primary}
                output={preview.output}
                exitCode={preview.running ? undefined : 0}
                running={preview.running ?? false}
                labels={RULE3_TERMINAL_LABELS}
                maxLines={8}
                accessory={preview.running ? undefined : row.detail}
                className="rule3-real-preview rule3-flat-preview"
              />
            )
            : (
              <div className="rule3-preview-error" role="status">
                <span className="rule3-preview-error-state">{row.state}</span>
                <p>{preview.message}</p>
              </div>
            )}
    </div>
  )
}

/**
 * A hand-built Rule 3 proposal: tabs keep every tool call visible, each tab
 * exposes one summary line and one row per item, and clicking a row opens the
 * real ReadBlock / DiffBlock / TerminalBlock for that file or command.
 */
export function RuleThreeShowcase(): ReactNode {
  const [activeTool, setActiveTool] = useState<Rule3Tool>('read')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [closingRow, setClosingRow] = useState<Rule3Row | null>(null)
  const closeTimer = useRef<number | null>(null)
  const example = RULE3_EXAMPLES.find(item => item.id === activeTool) ?? RULE3_EXAMPLES[0]!
  const selectedRow = example.rows.find(row => rule3RowKey(row) === selectedPath) ?? null
  const previewRow = selectedRow ?? closingRow
  const isCollapsed = selectedRow === null && closingRow === null

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  const selectTool = (tool: Rule3Tool) => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setClosingRow(null)
    setActiveTool(tool)
    setSelectedPath(null)
  }

  const closePreview = () => {
    if (selectedRow === null) return
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    setClosingRow(selectedRow)
    setSelectedPath(null)
    closeTimer.current = window.setTimeout(() => {
      setClosingRow(null)
      closeTimer.current = null
    }, 340)
  }

  const openRow = (row: Rule3Row) => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setClosingRow(null)
    setSelectedPath(rule3RowKey(row))
  }

  const toggleRow = (row: Rule3Row) => {
    if (selectedRow !== null && rule3RowKey(selectedRow) === rule3RowKey(row)) {
      closePreview()
    } else {
      openRow(row)
    }
  }

  const moveTab = (offset: number) => {
    const index = RULE3_EXAMPLES.findIndex(item => item.id === activeTool)
    const next = RULE3_EXAMPLES[(index + offset + RULE3_EXAMPLES.length) % RULE3_EXAMPLES.length]!
    selectTool(next.id)
    requestAnimationFrame(() => document.getElementById(`rule3-tab-${next.id}`)?.focus())
  }

  return (
    <section className="rule3" aria-labelledby="rule3-title">
      <div className="rule3-head">
        <div className="rule3-kicker">UI Rule 3</div>
        <h2 id="rule3-title">Tools are structured and concise.</h2>
        <p>
          Tabs keep every tool call visible. State comes first, then the file or command;
          click a row for the real read, diff or terminal. Status uses an 8px pixel check, cross or loader.
        </p>
        <div className="rule3-principles">
          <span>01 · Tabs, not accordions</span>
          <span>02 · One row per item</span>
          <span>03 · Detail on demand</span>
        </div>
        <div className="rule3-status-legend" role="group" aria-label="Pixel status icons">
          <span><Rule3StatusIcon tone="ok" /> Done</span>
          <span><Rule3StatusIcon tone="running" /> Running</span>
          <span><Rule3StatusIcon tone="error" /> Issue</span>
        </div>
        <p className="rule3-compare">
          Hand-built proposal; the real components stay in the cards below.
          Compare with <a href="#spec-read">Read</a>, <a href="#spec-file-mutation">Write</a>, <a href="#spec-bash">Bash</a>, and the <a href="#spec-tool-generic">Generic tool card</a>.
        </p>
      </div>
      <div className="rule3-workbench">
        <div className="rule3-tabs" role="tablist" aria-label="Tool calls">
          {RULE3_EXAMPLES.map(item => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`rule3-tab-${item.id}`}
              aria-selected={item.id === activeTool}
              aria-controls="rule3-panel"
              tabIndex={item.id === activeTool ? 0 : -1}
              className="rule3-tab"
              data-tool={item.id}
              onClick={() => selectTool(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault()
                  moveTab(1)
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  moveTab(-1)
                }
              }}
            >
              <span className="rule3-pixel-wrap"><Rule3ToolIcon tool={item.id} /></span>
              <span className="rule3-tab-copy">
                <strong>{item.title}</strong>
                <span>{item.count}</span>
              </span>
              <span className="rule3-tab-state">{rule3TabState(item.rows)}</span>
            </button>
          ))}
        </div>
        <div
          className="rule3-panel"
          role="tabpanel"
          id="rule3-panel"
          aria-labelledby={`rule3-tab-${example.id}`}
          data-tool={example.id}
        >
          <div className={`rule3-master${selectedRow ? ' is-preview-open' : ''}`}>
            <div className="rule3-table" role="table" aria-label={`${example.title} items`}>
              <div className="rule3-tr rule3-header" role="row">
                {example.columns.map(column => (
                  <span className="rule3-cell" role="columnheader" key={column}>{column}</span>
                ))}
              </div>
              {example.rows.map((row) => {
                const isSelected = selectedRow !== null && rule3RowKey(selectedRow) === rule3RowKey(row)
                return (
                  <div className={`rule3-tr rule3-${row.tone}${isSelected ? ' is-selected' : ''}`} role="row" key={rule3RowKey(row)}>
                    <span className="rule3-cell rule3-state" role="cell">
                      <Rule3StatusIcon tone={row.tone} />
                      <span>{row.state}</span>
                    </span>
                    <span className="rule3-cell rule3-primary" role="cell">
                      <button
                        type="button"
                        className="rule3-row-hit"
                        onClick={() => toggleRow(row)}
                        aria-label={`Preview ${row.primary}`}
                        aria-expanded={isSelected}
                      />
                      <span className="rule3-row-text" title={row.primary}>{row.primary}</span>
                    </span>
                    <span className="rule3-cell rule3-detail" role="cell" title={row.detail}>{row.detail}</span>
                  </div>
                )
              })}
            </div>
            <div
              className={`rule3-preview${isCollapsed ? ' is-collapsed' : ''}`}
              aria-live="polite"
              aria-hidden={selectedRow === null ? true : undefined}
            >
              {previewRow
                ? <Rule3PreviewPanel key={rule3RowKey(previewRow)} row={previewRow} onClose={closePreview} />
                : <Rule3EmptyPreview tool={example.id} />}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export const SPECIMENS: readonly Specimen[] = [
  {
    id: 'user',
    group: 'chat',
    kind: 'user',
    component: 'UserMessageNodeView',
    title: 'User message',
    blurb: 'The right-aligned user bubble, with the real reference projection, clock and copy action.',
    variants: [
      {
        label: 'Plain',
        render: () => shell({ children: <UserMessageNodeView node={userMessage('How do I add a tool to the registry? I want the schema and the handler in one place.')} {...baseProps} /> }),
      },
      {
        label: 'References',
        render: () => shell({ children: <UserMessageNodeView node={userMessage('Review @src/main.ts and @AGENTS.md before the change. Keep the patch small.')} {...baseProps} /> }),
      },
      {
        label: 'Steering',
        render: () => shell({ children: <UserMessageNodeView node={steeringMessage('While you are there, also check the empty state.')} {...baseProps} /> }),
      },
    ],
  },
  {
    id: 'context',
    group: 'chat',
    kind: 'context',
    component: 'ContextMessageNodeView',
    title: 'Context injection',
    blurb: 'The collapsed disclosure row that carries instructions, recalled notes and plugin context into the flow.',
    variants: [
      {
        label: 'Instructions',
        render: () => shell({ children: <ContextMessageNodeView node={contextMessage('instructions', 'AGENTS.md', '# Agent rules\n\n- Read the repository before you edit.\n- Keep the change focused.')} {...baseProps} /> }),
      },
      {
        label: 'Opaque',
        render: () => shell({ children: <ContextMessageNodeView node={contextMessage(null, 'mcp-server', 'A producer this UI version does not know. The row still stays visible.')} {...baseProps} /> }),
      },
      {
        label: 'Recall',
        render: () => shell({
          children: <ContextMessageNodeView node={node('context', {
            kind: 'context',
            seq: 3,
            time: Date.now(),
            content: [{ type: 'text', text: 'Recalled from a sibling session: the migration was paused at the index step.' }],
            source: { kind: 'recall' },
            provenance: { role: 'recall', label: 'Research session' },
            form: 'recall',
          })} {...baseProps} />,
        }),
      },
    ],
  },
  {
    id: 'assistant',
    group: 'chat',
    kind: 'assistant-step-message',
    component: 'AssistantNodeView',
    title: 'Assistant answer',
    blurb: 'The real markdown answer surface: headings, lists, links and highlighted code, streaming or settled.',
    variants: [
      {
        label: 'Markdown',
        render: () => shell({ children: <AssistantNodeView node={assistantMessage('Tools are registered with `defineTool`. The schema is a Zod object, and the handler receives the parsed input.\n\n- Keep the schema beside the handler.\n- Return text, not a UI component.\n\n[Open the tool guide](https://example.com/tools)')} {...baseProps} /> }),
      },
      {
        label: 'Code',
        render: () => shell({ children: <AssistantNodeView node={assistantMessage('Register the tool with its input schema:\n\n```ts\nexport const grep = defineTool({\n  name: \'grep\',\n  input: z.object({ pattern: z.string() }),\n  async run(input, ctx) {\n    return ctx.search(input.pattern)\n  },\n})\n```\n\nThe host resolves the tool by name.')} {...baseProps} /> }),
      },
      {
        label: 'Streaming',
        render: () => shell({ children: <AssistantNodeView node={assistantMessage('The handler is parsing the workspace now', 'running')} {...baseProps} /> }),
      },
      {
        label: 'Interrupted',
        render: () => shell({ children: <AssistantNodeView node={assistantMessage('The handler was stopped before it could finish the write.', 'interrupted')} {...baseProps} /> }),
      },
    ],
  },
  {
    id: 'reasoning',
    group: 'chat',
    kind: 'assistant-step-reason',
    component: 'AssistantNodeView',
    title: 'Reasoning',
    blurb: 'The reasoning section uses the same real renderer, but only paints when sanitized reasoning text exists.',
    variants: [
      {
        label: 'Settled',
        render: () => shell({ children: <AssistantNodeView node={assistantMessage('The registry already has a grep tool, so I should read its schema before adding a second one.', 'settled', 'assistant-step-reason')} {...baseProps} /> }),
      },
      {
        label: 'Streaming',
        render: () => shell({ children: <AssistantNodeView node={assistantMessage('Checking the existing tool contract first', 'running', 'assistant-step-reason')} {...baseProps} /> }),
      },
    ],
  },
  {
    id: 'system-prompt',
    group: 'chat',
    kind: 'system-prompt',
    component: 'SystemPromptNodeView',
    title: 'System prompt',
    blurb: 'The real collapsed system-prompt row. Use “Open disclosures” above to inspect the body.',
    variants: [
      { label: 'Collapsed', render: () => shell({ children: <SystemPromptNodeView node={prompt} {...baseProps} /> }) },
    ],
  },
  {
    id: 'tool-generic',
    group: 'tool',
    kind: 'tool-call',
    component: 'GenericToolCard',
    title: 'Generic tool call',
    blurb: 'The fallback tool card used when no keyed toolview claims the tool name. Running, settled and failed states.',
    variants: [
      { label: 'Running', render: () => shell({ children: toolCard(runningBlock('run_code', '{"code":"await verify()"}')) }) },
      { label: 'OK', render: () => shell({ children: toolCard(resultBlock('run_code', '{"code":"await verify()"}', 'verified 12 files')) }) },
      { label: 'Error', render: () => shell({ children: toolCard(resultBlock('run_code', '{"code":"await verify()"}', 'verification failed: 2 files changed', { isError: true })) }) },
    ],
  },
  {
    id: 'bash',
    group: 'tool',
    kind: 'tool-call',
    component: 'BashRow',
    title: 'Bash',
    blurb: 'The real terminal card, including the running sweep, the exit pill and the persisted elapsed time.',
    variants: [
      { label: 'Running', render: () => shell({ children: toolCard(runningBlock('bash', '{"command":"pnpm test"}')) }) },
      { label: 'OK', render: () => shell({ children: toolCard(resultBlock('bash', '{"command":"pnpm test"}', '✓ 24 tests passed\nDuration 12.41s')) }) },
      { label: 'Failed', render: () => shell({ children: toolCard(resultBlock('bash', '{"command":"pnpm test"}', 'FAIL src/main.test.ts\n  expected 200, received 500', { isError: true })) }) },
      {
        label: 'Batch',
        render: () => shell({ children: toolCard(resultBlock(
          'multi_bash',
          JSON.stringify({ description: 'lint and test', bash_array: [{ command: 'pnpm lint' }, { command: 'pnpm test' }] }),
          '[1/2] $ pnpm lint\n✓ no lint errors\n[exit code: 0]\n[2/2] $ pnpm test\n✓ 24 tests passed\n[exit code: 0]',
          { meta: { frames: [{ durationMs: 1_200 }, { durationMs: 12_400 }] } },
        )) }) },
    ],
  },
  {
    id: 'read',
    group: 'tool',
    kind: 'tool-call',
    component: 'ReadRow',
    title: 'Read',
    blurb: 'The read-family row with its file title, language and the real collapsed body.',
    variants: [
      {
        label: 'Read',
        render: () => shell({ children: toolCard(resultBlock(
          'read',
          JSON.stringify({ file_path: 'src/main.ts' }),
          '<path>src/main.ts</path>\n<type>file</type>\n<content>\nexport function main() {\n  return 1\n}\n</content>',
          { meta: { path: 'src/main.ts', offset: 1, lines: [
            { number: 1, text: 'export function main() {' },
            { number: 2, text: '  return 1' },
            { number: 3, text: '}' },
          ], totalLines: 3, lang: 'ts' } },
        )) }) },
      {
        label: 'Multi-read',
        render: () => shell({ children: toolCard(resultBlock(
          'multi_read',
          JSON.stringify({ read_array: [
            { path: 'src/main.ts' },
            { path: 'src/tool.ts', offset: 12 },
            { path: 'src/missing.ts' },
          ] }),
          '[1/3] src/main.ts\n<path>src/main.ts</path>\n<type>file</type>\n<content>\nexport function main() {\n  return 1\n}\n</content>\n[2/3] src/tool.ts\n<path>src/tool.ts</path>\n<type>file</type>\n<content>\nexport function defineTool() {\n  return 1\n}\n</content>\n[3/3] src/missing.ts\n[error: not found]',
          { meta: { frames: [
            { index: 0, file_path: 'src/main.ts', kind: 'read', path: 'src/main.ts', offset: 1, lines: [
              { number: 1, text: 'export function main() {' },
              { number: 2, text: '  return 1' },
              { number: 3, text: '}' },
            ], totalLines: 3, lang: 'ts' },
            { index: 1, file_path: 'src/tool.ts', kind: 'read', path: 'src/tool.ts', offset: 12, lines: [
              { number: 12, text: 'export function defineTool() {' },
              { number: 13, text: '  return 1' },
              { number: 14, text: '}' },
            ], totalLines: 14, lang: 'ts' },
            { index: 2, file_path: 'src/missing.ts', kind: 'error', message: 'not found' },
          ] } },
        )) }) },
      {
        label: 'Window',
        render: () => shell({ children: toolCard(resultBlock(
          'read',
          JSON.stringify({ file_path: 'src/huge.ts', offset: 120, limit: 3 }),
          '<path>src/huge.ts</path>\n<type>file</type>\n<content>\n  const row = rows[120]\n  return row\n}\n</content>',
          { meta: { path: 'src/huge.ts', offset: 120, lines: [
            { number: 120, text: '  const row = rows[120]' },
            { number: 121, text: '  return row' },
            { number: 122, text: '}' },
          ], totalLines: 2_480, lang: 'ts' } },
        )) }) },
    ],
  },
  {
    id: 'file-mutation',
    group: 'tool',
    kind: 'tool-call',
    component: 'FileMutationRow',
    title: 'File mutation',
    blurb: 'Write, edit and multi-write all share the real mutation row and its diff body.',
    variants: [
      {
        label: 'Write',
        render: () => shell({ children: toolCard(resultBlock(
          'write',
          JSON.stringify({ file_path: 'src/tool.ts', content: 'export function tool() {\n  return 1\n}\n' }),
          'Created file',
          { meta: { diffs: [{ path: 'src/tool.ts', oldText: null, newText: 'export function tool() {\n  return 1\n}\n' }] } },
        )) }) },
      {
        label: 'Edit',
        render: () => shell({ children: toolCard(resultBlock(
          'edit',
          JSON.stringify({ file_path: 'src/tool.ts', old_string: 'return 1', new_string: 'return 2' }),
          'Updated 1 file',
          { meta: { diffs: [{ path: 'src/tool.ts', oldText: 'return 1', newText: 'return 2' }] } },
        )) }) },
      {
        label: 'Multi-write',
        render: () => shell({ children: toolCard(resultBlock(
          'multi_write',
          JSON.stringify({ write_array: [
            { path: 'fixtures/a.txt', content: 'alpha\nbeta\n' },
            { path: 'src/handler.ts', edits: [{ old_string: 'respond(401)', new_string: "respond(401, 'missing')" }] },
            { path: 'locked.txt', content: 'x' },
          ] }),
          '[1/3] fixtures/a.txt\nwritten\n[2/3] src/handler.ts\nwritten\n[3/3] locked.txt\n[error: not read this session]',
          { meta: { frames: [
            { index: 0, file_path: 'fixtures/a.txt', kind: 'written', path: 'fixtures/a.txt', before: null, after: 'alpha\nbeta\n', committed: true },
            { index: 1, file_path: 'src/handler.ts', kind: 'written', path: 'src/handler.ts', before: '  respond(401)', after: "  respond(401, 'missing')", committed: true, outcomes: [{ index: 0, kind: 'replace', matches: 1 }] },
            { index: 2, file_path: 'locked.txt', kind: 'error', message: 'not read this session' },
          ] } },
        )) }) },
    ],
  },
  {
    id: 'search',
    group: 'tool',
    kind: 'tool-call',
    component: 'SearchRow',
    title: 'Search',
    blurb: 'Grep and glob share the real search row; the result body is the repository’s own result presentation.',
    variants: [
      { label: 'Grep', render: () => shell({ children: toolCard(resultBlock('grep', '{"pattern":"defineTool"}', 'src/tool.ts:14: export const grep = defineTool({' )) }) },
      { label: 'Glob', render: () => shell({ children: toolCard(resultBlock('glob', '{"pattern":"src/**/*.ts"}', 'src/main.ts\nsrc/tool.ts\nsrc/tool.test.ts')) }) },
    ],
  },
  {
    id: 'web',
    group: 'tool',
    kind: 'tool-call',
    component: 'WebRow',
    title: 'Web',
    blurb: 'Web search and web fetch keep the real row chrome and the source list body.',
    variants: [
      { label: 'Search', render: () => shell({ children: toolCard(resultBlock('web_search', '{"query":"React CSS modules"}', '1. React documentation\n2. CSS Modules specification')) }) },
      { label: 'Fetch', render: () => shell({ children: toolCard(resultBlock('web_fetch', '{"url":"https://react.dev"}', 'React lets you build user interfaces out of individual pieces.')) }) },
    ],
  },
  {
    id: 'todo',
    group: 'tool',
    kind: 'tool-call',
    component: 'TodoRow',
    title: 'Todo write',
    blurb: 'The plan summary is derived from the real todo tool arguments, including the active-item count.',
    variants: [
      { label: 'Plan', render: () => shell({ children: toolCard(resultBlock('todo_write', '{"todos":[{"content":"Read the existing tool","status":"completed"},{"content":"Add the new schema","status":"in_progress"},{"content":"Run the checks","status":"pending"}]}', 'Plan updated.')) }) },
    ],
  },
  {
    id: 'ask',
    group: 'tool',
    kind: 'tool-call',
    component: 'AskQuestionRow',
    title: 'Ask question',
    blurb: 'The real Ask row for a pending question and for the settled answer record.',
    variants: [
      { label: 'Waiting', render: () => shell({ children: toolCard(runningBlock('ask_user_question', '{"questions":[{"id":"db","question":"Which database should the demo use?","options":[{"label":"Postgres"},{"label":"SQLite"}]}]}')) }) },
      { label: 'Answered', render: () => shell({ children: toolCard(resultBlock('ask_user_question', '{"questions":[{"id":"db","question":"Which database should the demo use?","options":[{"label":"Postgres"},{"label":"SQLite"}]}]}', '{"answers":[{"id":"db","selected":["Postgres"]}]}')) }) },
    ],
  },
  {
    id: 'read-image',
    group: 'tool',
    kind: 'tool-call',
    component: 'ReadImageRow',
    title: 'Read image',
    blurb: 'The read-family image row. The image slot itself is owned by the attachment surface, so this specimen shows the text fallback.',
    variants: [
      { label: 'Refused', render: () => shell({ children: toolCard(resultBlock('read_image', '{"path":"docs/arch.png"}', 'This route does not support image input.', { isError: true })) }) },
    ],
  },
  {
    id: 'subcalls',
    group: 'tool',
    kind: 'tool-call',
    component: 'ToolCallTree',
    title: 'Tool subcalls',
    blurb: 'The recursive tree: a parent call owns child calls, and each child owns its own indentation and body.',
    variants: [
      {
        label: 'Nested',
        render: () => shell({
          children: toolCard(resultBlock('run_code', '{"code":"await inspectWorkspace()"}', 'inspected 3 files', {
            subCalls: [
              resultBlock('bash', '{"command":"pnpm typecheck"}', '✓ typecheck passed', {
                subCalls: [resultBlock('read', '{"path":"src/tool.ts"}', 'export const tool = ...')],
              }),
              resultBlock('grep', '{"pattern":"defineTool"}', 'src/tool.ts:14: export const grep = defineTool({'),
            ],
          })),
        }),
      },
    ],
  },
  {
    id: 'command',
    group: 'lifecycle',
    kind: 'command',
    component: 'CommandNodeView',
    title: 'Command',
    blurb: 'The real command row for success, failure and an executing command.',
    variants: [
      { label: 'Success', render: () => shell({ children: <CommandNodeView node={commandNode('plan', { kind: 'success', text: 'Entered plan mode.' })} {...baseProps} renderSlot={renderToolSlot as never} /> }) },
      { label: 'Error', render: () => shell({ children: <CommandNodeView node={commandNode('plan', { kind: 'error', text: 'Plan mode is already active.' })} {...baseProps} renderSlot={renderToolSlot as never} /> }) },
      { label: 'Running', render: () => shell({ children: <CommandNodeView node={commandNode('compact', null)} {...baseProps} renderSlot={renderToolSlot as never} /> }) },
    ],
  },
  {
    id: 'manual-compaction',
    group: 'lifecycle',
    kind: 'manual-compaction',
    component: 'ManualCompactionNodeView',
    title: 'Manual compaction',
    blurb: 'One `/compact` command and its correlated checkpoint transaction in the real integrated card.',
    variants: [
      { label: 'Settled', render: () => shell({ children: <ManualCompactionNodeView node={node('manual-compaction', manualCompaction)} {...baseProps} /> }) },
    ],
  },
  {
    id: 'compaction',
    group: 'lifecycle',
    kind: 'compaction',
    component: 'CompactionNodeView',
    title: 'Compaction summary',
    blurb: 'The automatic checkpoint marker and its expandable summary body.',
    variants: [
      { label: 'Settled', render: () => shell({ children: <CompactionNodeView node={node('compaction', compaction)} {...baseProps} /> }) },
    ],
  },
  {
    id: 'retry',
    group: 'lifecycle',
    kind: 'model-retry',
    component: 'RetryNodeView',
    title: 'Model retry',
    blurb: 'The correlated retry chain, with the live countdown and the provider failure details.',
    variants: [
      { label: 'Scheduled', render: () => shell({ children: <RetryNodeView node={node('model-retry', { current: retry, attempts: [retry] })} {...baseProps} /> }) },
      { label: 'Started', render: () => shell({ children: <RetryNodeView node={node('model-retry', { current: { ...retry, retryState: 'started' }, attempts: [retry] })} {...baseProps} /> }) },
    ],
  },
  {
    id: 'turn-error',
    group: 'lifecycle',
    kind: 'turn-error',
    component: 'TurnErrorNodeView',
    title: 'Turn error',
    blurb: 'The terminal turn failure notice, separate from the retry chain that may have preceded it.',
    variants: [
      { label: 'Error', render: () => shell({ children: <TurnErrorNodeView node={node('turn-error', turnError)} {...baseProps} /> }) },
    ],
  },
  {
    id: 'max-tokens',
    group: 'lifecycle',
    kind: 'turn-max-tokens',
    component: 'TurnMaxTokensNodeView',
    title: 'Max tokens',
    blurb: 'The per-request output-token cap notice.',
    variants: [
      { label: 'Notice', render: () => shell({ children: <TurnMaxTokensNodeView node={node('turn-max-tokens', maxTokens)} {...baseProps} /> }) },
    ],
  },
  {
    id: 'turn-tail',
    group: 'lifecycle',
    kind: 'turn-tail',
    component: 'TurnTailNodeView',
    title: 'Turn tail',
    blurb: 'The turn-local action row, token usage and duration panel. The real component reads its Turn from the location index.',
    variants: [
      { label: 'Settled', render: () => shell({ children: <TurnTailNodeView node={turnTail} {...baseProps} useChat={turnTailChat as never} renderSlot={(() => null) as never} renderSlotChain={(() => null) as never} /> }) },
    ],
  },
  {
    id: 'unknown',
    group: 'lifecycle',
    kind: 'unknown',
    component: 'UnknownNodeView',
    title: 'Unknown surface',
    blurb: 'The fallback JSON row for a surface event this UI version does not know.',
    variants: [
      { label: 'Fallback', render: () => shell({ children: <UnknownNodeView node={unknown} {...baseProps} /> }) },
    ],
  },
  {
    id: 'steering',
    group: 'chat',
    kind: 'steering',
    component: 'UserMessageNodeView',
    title: 'Steering message',
    blurb: 'A human message admitted from the next-step inbox while a turn was running. It uses the same real user renderer with the steering node kind.',
    variants: [
      { label: 'Steering', render: () => shell({ children: <UserMessageNodeView node={steeringMessage('Also check the keyboard path while the turn is still running.')} {...baseProps} /> }) },
    ],
  },
  {
    id: 'step-boundary',
    group: 'chat',
    kind: 'assistant-step-start / end',
    component: 'DeclinedStepBoundaryView',
    title: 'Step boundaries',
    blurb: 'The registered renderer for both Step boundary keys is a one-line component that returns null: the boundaries delimit spans but add no transcript row.',
    note: 'Both assistant-step-start and assistant-step-end mount this renderer. The empty stage is the faithful result, not a missing specimen.',
    variants: [
      { label: 'Start', render: () => shell({ children: <DeclinedStepBoundaryView /> }) },
      { label: 'End', render: () => shell({ children: <DeclinedStepBoundaryView /> }) },
    ],
  },
  {
    id: 'workflow-run',
    group: 'extension',
    kind: 'workflow-run',
    component: 'WorkflowRunPanel',
    title: 'Workflow run',
    blurb: 'The real workflow panel: an expandable run row with phases, members and their live status dots.',
    variants: [
      { label: 'Running', render: () => shell({ children: <WorkflowRunPanel node={node('workflow-run', { name: 'review', status: 'running', phases: [{ key: 'value:4:plan', phase: 'plan', members: [{ seq: 1, label: 'scout', childId: 'child-1', status: 'completed' }, { seq: 2, label: 'planner', childId: 'child-2', status: 'running' }] }, { key: 'value:5:build', phase: 'build', members: [{ seq: 3, label: 'builder', childId: 'child-3', status: 'running' }] }] })} {...baseProps} /> }) },
      { label: 'Completed', render: () => shell({ children: <WorkflowRunPanel node={node('workflow-run', { name: 'review', status: 'completed', phases: [{ key: 'value:4:plan', phase: 'plan', members: [{ seq: 1, label: 'scout', childId: 'child-1', status: 'completed' }, { seq: 2, label: 'planner', childId: 'child-2', status: 'completed' }] }] })} {...baseProps} /> }) },
    ],
  },
  {
    id: 'inbox',
    group: 'lifecycle',
    kind: 'inbox-next-step',
    component: 'state-only Definition',
    title: 'Inbox next step (state only)',
    blurb: 'This Definition contributes view state for the next-step inbox; it does not own a transcript kind or a keyed Chat renderer.',
    note: 'There is no ChatNode for inbox-next-step. The card is included so the complete Definition set is visible, not to imply a row.',
    variants: [
      { label: 'Definition', render: () => <div className="state-only">No transcript row is registered for this Definition. The composer owns the inbox surface.</div> },
    ],
  },
  {
    id: 'goal-input',
    group: 'extension',
    kind: 'command-input',
    component: 'GoalCommandInputView',
    title: 'Goal command input',
    blurb: 'The real `/goal` input bubble, with the command token decorated by the user-text projector.',
    variants: [
      { label: 'Goal', render: () => shell({ children: <GoalCommandInputView node={node('command-input', { text: '/goal ship the real component gallery' })} {...baseProps} /> }) },
    ],
  },
]
