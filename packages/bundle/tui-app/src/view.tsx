/**
 * @deepseek-ai/dsh-tui-app — the Ink component tree for the fullscreen chat
 * window: alternate-screen takeover, a pinned header band, a tail-anchored
 * transcript viewport, the approval card, a bordered composer, and a pinned
 * status band. Behavior lives in the {@link TuiController}; this file is
 * keys-in / frames-out. Colors come from {@link THEME} (the repo's DO dark
 * design-platform tokens), never ad-hoc literals.
 *
 * @module
 */

import React, { useEffect, useReducer, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import { accentBold, formatCount, formatUsage, padLines, PALETTE, paletteText, renderMarkdown, wrapText } from './render.ts'
import { paint } from './ansi.ts'
import { THEME } from './theme.ts'
import type { TuiController, TuiEntry } from './controller.ts'

/** Props for the fullscreen terminal application. */
export interface AppProps {
  /** The state machine this view renders. */
  controller: TuiController
  /** Whether color styling survives (startup `--no-color` / `NO_COLOR`). */
  color: boolean
  /** The live session identity shown in the header band. */
  sessionId: string
  /** The working directory shown in the header band. */
  cwd: string
}

/** Background fill for a band when color survives (Ink-padded full width). */
function bg(color: boolean, token: string): { backgroundColor: string } | Record<string, never> {
  return color ? { backgroundColor: token } : {}
}

/** Foreground prop honoring `--no-color`. */
function fg(color: boolean, token: string): { color: string } | Record<string, never> {
  return color ? { color: token } : {}
}

/**
 * One immutable transcript row. Static entries are finished forever, so
 * nested Ink components (backgrounds, borders, italics) are safe here —
 * the ink-5 "nested Text inside a newline-bearing string" layout defect
 * only affects live, re-rendered regions.
 */
function EntryRow({ entry, color, columns }: { entry: TuiEntry; color: boolean; columns: number }): React.JSX.Element {
  switch (entry.kind) {
    case 'banner':
      return (
        <Box flexDirection="column">
          {entry.lines.map((line, index) => <Text key={index} {...fg(color, THEME.muted)}>{line}</Text>)}
        </Box>
      )
    case 'user': {
      // Uniform bubble block: wrap to the column budget, pad to width.
      const wrap = Math.max(28, Math.min(66, columns - 18))
      const block = ` ${padLines(wrapText(entry.text, wrap - 2), 1)}`
      return (
        <Box justifyContent="flex-end">
          <Text {...bg(color, THEME.userBubble)} {...fg(color, THEME.label)}>{block}</Text>
        </Box>
      )
    }
    case 'assistant': {
      // One composed string (bodies carry markdown SGR; nested Text inside a
      // newline-bearing child trips ink 5's layout): avatar on the first line,
      // continuation lines hang-indented under it, right edge padded uniform.
      const indent = Math.max(40, Math.min(76, columns - 8))
      const head = paletteText(PALETTE.violet, color, '✻')
      const md = renderMarkdown(wrapText(entry.text, indent - 4), color)
      const lines = md.split('\n')
      const first = ` ${head}  ${lines[0] ?? ''}`
      const rest = lines.slice(1).map(line => `    ${line}`)
      const body = padLines([first, ...rest].join('\n'), 1)
      return <Text {...bg(color, THEME.assistantBubble)} {...fg(color, THEME.dim)}>{body}</Text>
    }
    case 'reasoning':
      return <Text italic {...fg(color, THEME.tertiary)} wrap="wrap">· {entry.text}</Text>
    case 'note':
      return <Text {...fg(color, THEME.tertiary)} wrap="wrap">· {entry.text}</Text>
    case 'info':
      return <Text {...fg(color, THEME.tertiary)} wrap="wrap">{entry.text}</Text>
    case 'error':
      return (
        <Text wrap="wrap">
          <Text {...fg(color, THEME.danger)}>✗ </Text>{entry.text}
        </Text>
      )
    case 'help':
      return <Text {...fg(color, THEME.tertiary)}>{entry.text}</Text>
    case 'tool-call':
      return (
        <Text wrap="wrap">
          <Text bold {...fg(color, THEME.brand)}>▸ </Text>
          <Text {...fg(color, THEME.dim)}>{entry.summary}</Text>
        </Text>
      )
    case 'tool-result': {
      if (entry.error !== undefined) {
        const first = entry.lines[0] ?? '(no message)'
        return (
          <Box flexDirection="column">
            <Text {...fg(color, THEME.danger)} wrap="wrap">✗ {entry.error} — {first}</Text>
            {entry.extra > 0 && <Text {...fg(color, THEME.muted)}>  … {entry.extra} more lines</Text>}
          </Box>
        )
      }
      return (
        <Box flexDirection="column">
          {entry.lines.map((line, index) => (
            <Text key={index} {...fg(color, THEME.tertiary)} wrap="wrap">  {line}</Text>
          ))}
          {entry.extra > 0 && <Text {...fg(color, THEME.muted)}>  … {entry.extra} more lines</Text>}
        </Box>
      )
    }
    case 'turn': {
      const usage = entry.usage === '' ? '' : ` · ${entry.usage}`
      return <Text {...fg(color, THEME.muted)}>turn {entry.turn} · {entry.durationSeconds}s{usage}</Text>
    }
    case 'approval': {
      const granted = entry.decision === 'allowed-once'
      return (
        <Text wrap="wrap">
          <Text {...fg(color, granted ? THEME.success : THEME.danger)}>{granted ? '✓' : '✗'}</Text>
          <Text {...fg(color, THEME.dim)}> {granted ? 'allowed once' : entry.decision}</Text>
          <Text {...fg(color, THEME.tertiary)}> · {entry.toolName}</Text>
        </Text>
      )
    }
    default:
      return <Text {...fg(color, THEME.tertiary)}>· {JSON.stringify(entry)}</Text>
  }
}

/** The live turn window (flat-string bodies; re-rendered every tick). */
function WorkingPane({ controller, color, columns }: {
  controller: TuiController
  color: boolean
  columns: number
}): React.JSX.Element | null {
  const working = controller.working
  if (working === undefined) return null
  const usage = working.usage === undefined ? '' : ` · ${formatUsage(working.usage)}`
  // Stream the live answer inside the same violet bubble the committed
  // assistant entries get, so a turn reads pure before and after commit.
  const answerBody = working.answer === ''
    ? ''
    : ((): string => {
      const indent = Math.max(40, Math.min(76, columns - 8))
      const head = paletteText(PALETTE.violet, color, '✻')
      const md = renderMarkdown(wrapText(working.answer.trimEnd(), indent - 4), color)
      const lines = md.split('\n')
      const first = ` ${head}  ${lines[0] ?? ''}`
      const rest = lines.slice(1).map(line => `    ${line}`)
      return padLines([first, ...rest].join('\n'), 1)
    })()
  return (
    <Box flexDirection="column">
      {working.reasoning !== '' && (
        <Text wrap="wrap">{paletteText(PALETTE.dim, color, `· ${working.reasoning.trimEnd()}`)}</Text>
      )}
      {answerBody !== '' && (
        <Text {...bg(color, THEME.assistantBubble)} {...fg(color, THEME.dim)}>{answerBody}</Text>
      )}
      <Text>
        {paletteText(PALETTE.accent, color, controller.spinGlyph())}
        {paletteText(PALETTE.dim, color, ` working… ${controller.elapsedSeconds()}s${usage}`)}
      </Text>
    </Box>
  )
}

/** The pinned header band: wordmark, provider/model, turn and session. */
function HeaderBand({ controller, color, sessionId, columns }: {
  controller: TuiController
  color: boolean
  sessionId: string
  columns: number
}): React.JSX.Element {
  const allFacts = controller.delegate.facts()
  // Widths of the composed segments (ascii/glyph-1 safe): the right cluster
  // anchors through a measured pad run because a Text cannot spread children;
  // `facts` is shortened from the left when the window cannot carry it.
  const turnText = `turn ${controller.turnCount}`
  const rightLen = turnText.length + sessionId.length + 2
  const fitBudget = columns - rightLen - 6
  const facts = allFacts.length <= fitBudget
    ? allFacts
    : `…${allFacts.slice(allFacts.length - Math.max(0, fitBudget - 1))}`
  const leftLen = facts.length + 5
  const pad = ' '.repeat(Math.max(1, columns - leftLen - rightLen))
  return (
    <Box flexShrink={0} height={1} overflow="hidden">
      <Text {...bg(color, THEME.band)}>
        {' '}
        <Text bold {...fg(color, THEME.brand)}>dsh</Text>
        {' '}{facts}
        {pad}
        <Text {...fg(color, THEME.muted)}>{turnText}</Text>
        {' '}{sessionId}{' '}
      </Text>
    </Box>
  )
}

/** The pinned footer band: approval policy, token counters, activity. */
function FooterBand({ controller, color, scrollOffset }: {
  controller: TuiController
  color: boolean
  scrollOffset: number
}): React.JSX.Element {
  const totals = controller.tokenTotals
  const approval = controller.delegate.approvalLabel() ?? 'none'
  const usage = totals.input === 0 && totals.output === 0
    ? undefined
    : `↑ ${formatCount(totals.input)} · ↓ ${formatCount(totals.output)}`
  const activity = controller.busy
    ? `working… ${controller.elapsedSeconds()}s`
    : 'idle'
  const scrollHint = scrollOffset === 0
    ? ''
    : `   ↑ scrolled ${scrollOffset} · pagedown resumes follow`
  // One composed string: JSX text/expression splicing inside a Text left
  // scrollHint silently dropped from this band (ink 5 squash behavior).
  const line = ` approvals ${approval}`
    + (usage === undefined ? '' : `   ${usage}`)
    + `   ${activity}${scrollHint} `
  return (
    <Box width="100%" flexShrink={0} height={1} overflow="hidden">
      <Text {...bg(color, THEME.band)} {...fg(color, THEME.muted)}>{line}</Text>
    </Box>
  )
}

/** The amber approval card centered above the composer. */
function ApprovalPane({ controller, color }: { controller: TuiController; color: boolean }): React.JSX.Element | null {
  const pending = controller.pendingApproval
  if (pending === undefined) return null
  return (
    <Box
      alignSelf="center"
      borderStyle="round"
      width={56}
      flexDirection="column"
      flexShrink={0}
      {...(color ? { borderColor: THEME.warnBorder } : {})}
    >
      <Text {...bg(color, THEME.warnBg)}>
        <Text bold {...fg(color, THEME.warn)}>⚠ {pending.toolName} asks for approval</Text>
      </Text>
      {pending.reason !== undefined && (
        <Text {...bg(color, THEME.warnBg)} {...fg(color, THEME.dim)} wrap="wrap">reason: {pending.reason}</Text>
      )}
      <Text {...bg(color, THEME.warnBg)} {...fg(color, THEME.tertiary)}>y allows once · anything else rejects</Text>
    </Box>
  )
}

/** One prompt row with an inverse-video cursor, multiline aware. */
function PromptLine(props: { readonly text: string; readonly cursor: number; readonly color: boolean }): React.JSX.Element {
  const { text, cursor, color } = props
  const at = text[cursor]
  const glyph = at === undefined ? ' ' : at === '\n' ? '⏎' : at
  // One flat string: nested Text inside a newline-bearing child trips ink 5's
  // layout on re-render, so styling rides pre-composed SGR strings.
  const content = accentBold(color, '› ')
    + text.slice(0, cursor)
    + paint(color, 'inverse', glyph)
    + text.slice(cursor + 1)
  return <Text wrap="wrap">{content}</Text>
}

/** Terminal window dimensions tracked from stdout resize events. */
interface WindowDims {
  columns: number
  rows: number
}

/**
 * The fullscreen terminal application: alternate-screen take-over, bands,
 * a tail-anchored transcript, and the composer. Ink owns stdin/stdout
 * mounting; ctrl+c is handled by the controller's two-strike policy rather
 * than Ink's default exit.
 */
export function App({ controller, color, sessionId }: AppProps): React.JSX.Element {
  const { exit } = useApp()
  const [, rerender] = useReducer((value: number) => value + 1, 0)
  const { stdout } = useStdout()
  const [dims, setDims] = useState<WindowDims>({
    columns: Number.isFinite(stdout.columns) ? stdout.columns : 80,
    rows: Number.isFinite(stdout.rows) ? stdout.rows : 24,
  })
  // Entries skipped from the tail: 0 = follow the newest transcript rows.
  const [scrolledBy, setScrolledBy] = useState(0)
  const [buffer, setBuffer] = useState('')
  const [cursor, setCursor] = useState(0)
  const [history, setHistory] = useState<string[]>([])
  const [historyCursor, setHistoryCursor] = useState(-1)
  useEffect(() => { return controller.onChanged(() => { rerender() }) }, [controller])
  useEffect(() => { return controller.onQuit(() => { exit() }) }, [controller, exit])
  // Terminal quirk bits ink leaves to the app: take the alternate screen so
  // the session owns the window (restored on exit), clear it, and enable
  // bracketed paste so paste bodies stay distinguishable from typed bursts.
  useEffect(() => {
    stdout.write('\x1B[?1049h\x1B[H\x1B[2J\x1B[?2004h')
    return () => { stdout.write('\x1B[?2004l\x1B[?1049l') }
  }, [stdout])
  useEffect(() => {
    const onResize = (): void => {
      setDims({
        columns: Number.isFinite(stdout.columns) ? stdout.columns : 80,
        rows: Number.isFinite(stdout.rows) ? stdout.rows : 24,
      })
    }
    stdout.on('resize', onResize)
    return () => { stdout.removeListener('resize', onResize) }
  }, [stdout])

  /** Insert `inserted` at the cursor (buffer/cursor state as of this render). */
  const insertText = (base: string, at: number, inserted: string): [string, number] => [
    base.slice(0, at) + inserted + base.slice(at),
    at + inserted.length,
  ]

  /** Commit the buffer content as one prompt line and reset the input. */
  const commitLine = (content: string): void => {
    const line = content.trim()
    if (line !== '') {
      setHistory(previous => previous[previous.length - 1] === line ? previous : [...previous, line])
      controller.submitLine(line)
    }
  }

  const submit = (): void => {
    if (buffer.trim() !== '') commitLine(buffer)
    setBuffer('')
    setCursor(0)
    setHistoryCursor(-1)
  }

  const recall = (direction: -1 | 1): void => {
    if (history.length === 0) return
    const index = historyCursor === -1
      ? (direction === -1 ? history.length - 1 : -1)
      : historyCursor + direction
    if (index < 0 || index >= history.length) {
      setHistoryCursor(-1)
      setBuffer('')
      setCursor(0)
      return
    }
    setHistoryCursor(index)
    const entry = history[index] ?? ''
    setBuffer(entry)
    setCursor(entry.length)
  }

  useInput((input, key) => {
    if (controller.pendingApproval !== undefined) {
      if (input === 'y' || input === 'Y') controller.approve('allowed-once')
      else if (input === 'n' || input === 'N' || key.return || key.escape || (key.ctrl && input === 'c')) {
        controller.approve('rejected')
      }
      return
    }
    if (key.ctrl) {
      switch (input) {
        case 'c': controller.ctrlC(); return
        case 'd':
          if (buffer === '') controller.requestQuit()
          else if (cursor < buffer.length) {
            setBuffer(buffer.slice(0, cursor) + buffer.slice(cursor + 1))
          }
          return
        case 'a': setCursor(0); return
        case 'e': setCursor(buffer.length); return
        case 'u': setBuffer(buffer.slice(cursor)); setCursor(0); return
        case 'k': setBuffer(buffer.slice(0, cursor)); return
        case 'w': {
          const left = buffer.slice(0, cursor)
          const trimmed = left.replace(/\s+$/, '')
          const cut = trimmed.match(/\S+$/)
          const start = trimmed.length - (cut === null ? 0 : cut[0].length)
          setBuffer(trimmed.slice(0, start) + buffer.slice(cursor))
          setCursor(start)
          return
        }
        default:
          return
      }
    }
    if (key.return) { submit(); return }
    // ink parses xterm's Backspace byte (0x7f) as `delete`; DEL proper is a
    // rarity, so erase backward for either key. Ctrl+D covers erase-forward.
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setBuffer(buffer.slice(0, cursor - 1) + buffer.slice(cursor))
        setCursor(cursor - 1)
      }
      return
    }
    if (key.leftArrow) { setCursor(Math.max(0, cursor - 1)); return }
    if (key.rightArrow) { setCursor(Math.min(buffer.length, cursor + 1)); return }
    if (key.upArrow) { recall(-1); return }
    if (key.downArrow) { recall(1); return }
    // Page keys must win over the escape guard: ink's parser hands any
    // https:// escape-initiated sequence an escape flag alongside pageUp.
    if (key.pageUp || input.includes('[5~')) {
      setScrolledBy(offset => Math.min(controller.entries.length, offset + 8))
      return
    }
    if (key.pageDown || input.includes('[6~')) {
      setScrolledBy(offset => Math.max(0, offset - 8))
      return
    }
    if (key.escape || key.tab) return
    if (key.meta) return
    setScrolledBy(0)
    if (input.includes('[200~') || input.includes('[201~')) {
      // Bracketed paste: a completed paste arrives wrapped in markers; carry
      // the body as literal multiline text newlines and all. Ink's parser
      // strips the leading escape, so the marker can stay bare.
      const body = input.replace(/\x1B?\[20[01]~/g, '').replace(/\r\n?/g, '\n')
      if (body === '') return
      const [nextBuffer, nextCursor] = insertText(buffer, cursor, body)
      setBuffer(nextBuffer)
      setCursor(nextCursor)
      setHistoryCursor(-1)
      return
    }
    // Typed chunks coalesce keystrokes: a CR/LF inside the chunk is the user
    // pressing enter, so each newline boundary commits the buffer as one
    // prompt. (Single-keystroke CR arrives as key.return and submits before
    // this branch; pastes take the bracketed-paste path above.)
    const segments = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    let nextBuffer = buffer
    let nextCursor = cursor
    for (const [index, segment] of segments.entries()) {
      if (segment !== '') {
        [nextBuffer, nextCursor] = insertText(nextBuffer, nextCursor, segment)
      }
      if (index < segments.length - 1) {
        commitLine(nextBuffer)
        nextBuffer = ''
        nextCursor = 0
      }
    }
    if (nextBuffer !== buffer || nextCursor !== cursor) {
      setBuffer(nextBuffer)
      setCursor(nextCursor)
      setHistoryCursor(-1)
    }
  })

  return (
    <Box
      width={dims.columns}
      height={dims.rows}
      flexDirection="column"
      overflow="hidden"
    >
      <HeaderBand controller={controller} color={color} sessionId={sessionId} columns={dims.columns} />

      {/* transcript: tail-anchored, clipped to the viewport. No ink Static —
          a Static node is absolutely positioned "permanent log" chrome that
          renders above the app frame, never inside a regional viewport; the
          fullscreen window re-renders these rows like ordinary children. */}
      <Box
        flexGrow={1}
        flexDirection="column"
        justifyContent="flex-end"
        overflow="hidden"
        paddingX={1}
      >
        {(() => {
          const entries = controller.entries
          const tail = Math.max(0, entries.length - scrolledBy)
          const visible = entries.slice(Math.max(0, tail - 40), tail)
          return visible.map(entry => (
            <Box key={entry.id} flexDirection="column" flexShrink={0}>
              <EntryRow entry={entry} color={color} columns={dims.columns} />
              <Text>{' '}</Text>
            </Box>
          ))
        })()}
        <WorkingPane controller={controller} color={color} columns={dims.columns} />
      </Box>

      <ApprovalPane controller={controller} color={color} />

      {/* composer: bordered card with the prompt and editing hints */}
      <Box
        borderStyle="round"
        marginX={1}
        paddingX={1}
        flexDirection="column"
        flexShrink={0}
        {...(color ? { borderColor: THEME.brand } : {})}
      >
        <PromptLine text={buffer} cursor={cursor} color={color} />
        <Text {...fg(color, THEME.muted)}>ctrl+j newline · ↑↓ history · /help commands</Text>
      </Box>

      <FooterBand controller={controller} color={color} scrollOffset={scrolledBy} />
    </Box>
  )
}
