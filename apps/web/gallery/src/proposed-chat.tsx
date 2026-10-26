import { useState, type ReactNode } from 'react'
import { PixelLoader } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  Rule3CloseIcon,
  Rule3StatusIcon,
  Rule3ToolIcon,
  type PixelMark,
  type Rule3Tone,
  type Specimen,
  type Variant,
} from './specimens.tsx'

interface ProposedChatElementProps {
  readonly spec: Specimen
  readonly variant: Variant
  readonly variantIndex: number
  readonly primary: string
  readonly detail: string
  readonly mark: PixelMark | null
  readonly avatar: string | null
  readonly tone: Rule3Tone
}

const SINGLE_TOOL_TABLES: Record<string, string> = { read: 'FILE', 'file-mutation': 'FILE', bash: 'COMMAND' }

const COLLAPSIBLE_IDS = new Set(['reasoning', 'context', 'system-prompt', 'compaction', 'manual-compaction', 'inbox'])
const TEXT_IDS = new Set(['user', 'assistant', 'steering', 'goal-input'])

const READ_MAIN = [
  'export function main() {',
  '  return 1',
  '}',
]

const READ_WINDOW = [
  '  const row = rows[120]',
  '  return row',
  '}',
]

const READ_TOOL = [
  'export const tool = defineTool({',
  "  name: 'grep',",
  '})',
]

const ASSISTANT_CODE = [
  'export const grep = defineTool({',
  "  name: 'grep',",
  '  input: z.object({ pattern: z.string() }),',
  '  async run(input, ctx) {',
  '    return ctx.search(input.pattern)',
  '  },',
  '})',
]

function elementPrimary(spec: Specimen, primary: string): string {
  if (spec.id === 'user' || spec.id === 'steering') return 'Human message'
  if (spec.id === 'goal-input') return 'Goal input'
  if (spec.id === 'assistant') return 'Answer'
  if (spec.id === 'context') return 'Context injection'
  if (spec.id === 'reasoning') return 'Think'
  if (spec.id === 'system-prompt') return 'System prompt'
  if (spec.group === 'lifecycle' || spec.group === 'extension') return spec.title
  return primary
}

function CodeLine(props: { readonly number?: number; readonly text: string; readonly kind?: 'add' | 'remove' }): ReactNode {
  return (
    <div className={`pce-line${props.kind ? ` is-${props.kind}` : ''}`}>
      {props.number !== undefined && <span className="pce-gutter">{props.number}</span>}
      <span>{props.text || ' '}</span>
    </div>
  )
}

function CodeBlock(props: {
  readonly path?: string
  readonly lines: readonly string[]
  readonly start?: number
  readonly lang?: string
}): ReactNode {
  return (
    <div className="pce-code">
      <div className="pce-code-head">
        <span>{props.path ?? 'code'}</span>
        <span>{props.lang ?? 'ts'}</span>
      </div>
      <div className="pce-code-body">
        {props.lines.map((line, i) => <CodeLine key={`${i}-${line}`} number={(props.start ?? 1) + i} text={line} />)}
      </div>
    </div>
  )
}

function Terminal(props: { readonly running?: boolean; readonly lines: readonly string[] }): ReactNode {
  return (
    <div className="pce-terminal">
      <div className="pce-terminal-head">
        <span>terminal</span>
        {props.running && <span className="pce-running"><PixelLoader size={10} mode="sweep" />running</span>}
      </div>
      {props.lines.map((line, i) => (
        <div key={`${i}-${line}`} className={`pce-line${line.startsWith('$') ? ' is-command' : ''}${line.includes('FAIL') ? ' is-error' : ''}`}>
          <span>{line}</span>
        </div>
      ))}
    </div>
  )
}

function DiffBlock(props: { readonly path: string; readonly lines: readonly { readonly kind: 'add' | 'remove' | 'ctx'; readonly text: string }[] }): ReactNode {
  return (
    <div className="pce-code pce-diff">
      <div className="pce-code-head"><span>{props.path}</span><span>diff</span></div>
      <div className="pce-code-body">
        {props.lines.map((line, i) => (
          <CodeLine key={`${i}-${line.text}`} kind={line.kind === 'add' ? 'add' : line.kind === 'remove' ? 'remove' : undefined} text={line.kind === 'add' ? `+ ${line.text}` : line.kind === 'remove' ? `- ${line.text}` : `  ${line.text}`} />
        ))}
      </div>
    </div>
  )
}

function ChatBody(props: ProposedChatElementProps): ReactNode {
  const { spec, variantIndex, primary, detail, tone } = props
  switch (spec.id) {
    case 'user':
    case 'steering':
    case 'goal-input':
      return (
        <div className="pce-bubble">
          <p>{primary}</p>
          <span>{detail}</span>
        </div>
      )
    case 'assistant':
      if (variantIndex === 1) return <CodeBlock path="src/tool.ts" lines={ASSISTANT_CODE} />
      return (
        <div className="pce-prose">
          <p>{primary}</p>
          {variantIndex === 0 && (
            <>
              <ul>
                <li>Keep the schema beside the handler.</li>
                <li>Return text, not a UI component.</li>
              </ul>
              <span className="pce-link">Open the tool guide ↗</span>
            </>
          )}
          {tone === 'running' && <div className="pce-running"><PixelLoader size={10} mode="sweep" />streaming</div>}
          {tone === 'error' && <div className="pce-error">Interrupted before the write completed.</div>}
        </div>
      )
    case 'reasoning':
      return (
        <div className="pce-prose">
          <p>{primary}</p>
          {tone === 'running' && <div className="pce-running"><PixelLoader size={10} mode="sweep" />thinking</div>}
        </div>
      )
    case 'context':
      return (
        <div className="pce-context">
          <div className="pce-context-head">
            <span className="pce-file-chip">{detail.split(' · ')[0]}</span>
            <span>{variantIndex === 0 ? 'instructions' : variantIndex === 1 ? 'opaque producer' : 'session recall'}</span>
          </div>
          <p>
            {variantIndex === 0
              ? '- Read the repository before you edit. - Keep the change focused.'
              : variantIndex === 1
                ? 'A producer this UI version does not know. The row still stays visible.'
                : 'Recalled from a sibling session: the migration was paused at the index step.'}
          </p>
          {tone === 'running' && <div className="pce-running"><PixelLoader size={10} mode="sweep" />loading context</div>}
        </div>
      )
    case 'system-prompt':
      return <CodeBlock path="AGENTS.md" lang="md" lines={['# Agent rules', '', '- Read the repository before you edit.', '- Keep the change focused.']} />
    case 'read':
      return variantIndex === 0
        ? <CodeBlock path="src/main.ts" lines={READ_MAIN} />
        : variantIndex === 1
          ? (
            <CodeBlock path="src/main.ts" lines={READ_MAIN} />
          )
          : <CodeBlock path="src/huge.ts" start={120} lines={READ_WINDOW} />
    case 'file-mutation':
      return variantIndex === 0
        ? <DiffBlock path="src/tool.ts" lines={[
          { kind: 'ctx', text: 'new file' }, { kind: 'add', text: 'export function tool() {' }, { kind: 'add', text: '  return 1' }, { kind: 'add', text: '}' },
        ]} />
        : variantIndex === 1
          ? <DiffBlock path="src/tool.ts" lines={[{ kind: 'remove', text: 'return 1' }, { kind: 'add', text: 'return 2' }]} />
          : (
            <DiffBlock path="src/handler.ts" lines={[{ kind: 'remove', text: '  respond(401)' }, { kind: 'add', text: "  respond(401, 'missing')" }]} />
          )
    case 'bash':
      return variantIndex === 0
        ? <Terminal running lines={['$ pnpm test', 'Waiting for the command to settle…']} />
        : variantIndex === 1
          ? <Terminal lines={['$ pnpm test', '✓ 24 tests passed', 'Duration 12.41s']} />
          : variantIndex === 2
            ? <Terminal lines={['$ pnpm test', 'FAIL src/main.test.ts', '  expected 200, received 500']} />
            : <Terminal lines={['[1/2] $ pnpm lint', '✓ no lint errors', '[2/2] $ pnpm test', '✓ 24 tests passed']} />
    case 'tool-generic':
      return variantIndex === 0
        ? <Terminal running lines={['# Code · await verify()', 'Inspecting the workspace…']} />
        : <div className={variantIndex === 2 ? 'pce-error' : 'pce-result'}>
          {variantIndex === 2 ? 'verification failed: 2 files changed' : 'verified 12 files'}
        </div>
    case 'search':
      return <div className="pce-list">{variantIndex === 0
        ? <><CodeLine text="src/tool.ts:14" /><CodeLine text="export const grep = defineTool({" /></>
        : <><CodeLine text="src/main.ts" /><CodeLine text="src/tool.ts" /><CodeLine text="src/tool.test.ts" /></>}</div>
    case 'web':
      return <div className="pce-list">{variantIndex === 0
        ? <><CodeLine text="1. React documentation" /><CodeLine text="2. CSS Modules specification" /></>
        : <CodeLine text="React lets you build user interfaces out of individual pieces." />}</div>
    case 'todo':
      return <div className="pce-todos">
        <span className="is-done">✓ Read the existing tool</span>
        <span className="is-active">● Add the new schema</span>
        <span>○ Run the checks</span>
      </div>
    case 'ask':
      return <div className="pce-ask">
        <p>Which database should the demo use?</p>
        <div className="pce-options"><span className={variantIndex === 1 ? 'is-picked' : ''}>Postgres</span><span>SQLite</span></div>
        <span className="pce-meta">{variantIndex === 1 ? 'answered' : 'waiting for an answer'}</span>
      </div>
    case 'read-image':
      return <div className="pce-error">This route does not support image input.</div>
    case 'subcalls':
      return <div className="pce-tree">
        <span className="pce-tree-root">run_code · inspected 3 files</span>
        <span>├ bash · pnpm typecheck · ✓</span>
        <span>│ └ read · src/tool.ts</span>
        <span>└ grep · defineTool · 1 match</span>
      </div>
    case 'command':
      return <div className={variantIndex === 1 ? 'pce-error' : 'pce-notice'}>
        {variantIndex === 0 ? 'Entered plan mode.' : variantIndex === 1 ? 'Plan mode is already active.' : 'Compacting the transcript…'}
        {tone === 'running' && <div className="pce-running"><PixelLoader size={10} mode="sweep" />running</div>}
      </div>
    case 'turn-error':
      return <div className="pce-error">The provider returned 429 after three attempts.</div>
    case 'max-tokens':
      return <div className="pce-notice">The output token cap was reached for this turn.</div>
    case 'retry':
      return <div className="pce-notice">Provider rate limit. Retry {variantIndex === 0 ? 'scheduled' : 'started'} for attempt 2.</div>
    case 'manual-compaction':
    case 'compaction':
      return <div className="pce-notice">Checkpoint created. The transcript before this point is summarized.</div>
    case 'turn-tail':
      return <div className="pce-meta-row"><span>tokens 12.4k</span><span>duration 8.2s</span><span>1 turn</span></div>
    case 'unknown':
      return <CodeBlock path="future/surface" lines={['{', '  "type": "future/surface",', '  "data": { "event": "future/surface" }', '}']} />
    case 'step-boundary':
      return <div className="pce-boundary"><span />{variantIndex === 0 ? 'step start' : 'step end'}<span /></div>
    case 'inbox':
      return <div className="pce-notice">No transcript row is registered for this Definition. The composer owns the inbox surface.</div>
    case 'workflow-run':
      return <div className="pce-phases">
        <span className="pce-phase"><b>plan</b><em>scout · completed</em><em>planner · {variantIndex === 0 ? 'running' : 'completed'}</em></span>
        {variantIndex === 0 && <span className="pce-phase"><b>build</b><em>builder · running</em></span>}
      </div>
    default:
      return <div className="pce-notice">{primary}</div>
  }
}

interface ArrayRow {
  readonly tone: Rule3Tone
  readonly state: string
  readonly primary: string
  readonly detail: string
}

function arrayRows(spec: Specimen, variantIndex: number): { readonly rows: readonly ArrayRow[]; readonly column: string } | null {
  if (spec.id === 'read' && variantIndex === 1) {
    return { column: 'FILE', rows: [
      { tone: 'ok', state: 'Read', primary: 'src/main.ts', detail: '3 lines' },
      { tone: 'ok', state: 'Read', primary: 'src/tool.ts', detail: 'lines 12–14 of 14' },
      { tone: 'error', state: 'Issue', primary: 'src/missing.ts', detail: 'not found' },
    ] }
  }
  if (spec.id === 'bash' && variantIndex === 3) {
    return { column: 'COMMAND', rows: [
      { tone: 'ok', state: 'OK', primary: 'pnpm lint', detail: '1.2s' },
      { tone: 'ok', state: 'OK', primary: 'pnpm test', detail: '12.4s' },
    ] }
  }
  if (spec.id === 'file-mutation' && variantIndex === 2) {
    return { column: 'FILE', rows: [
      { tone: 'ok', state: 'Write', primary: 'fixtures/a.txt', detail: '+2 lines' },
      { tone: 'ok', state: 'Edit', primary: 'src/handler.ts', detail: '1 replacement' },
      { tone: 'error', state: 'Issue', primary: 'locked.txt', detail: 'not read this session' },
    ] }
  }
  return null
}

function ToolDetail(props: ProposedChatElementProps & { readonly rowIndex: number }): ReactNode {
  const { spec, variantIndex, rowIndex, ...rest } = props
  if (spec.id === 'read' && variantIndex === 1) {
    if (rowIndex === 0) return <CodeBlock path="src/main.ts" lines={READ_MAIN} />
    if (rowIndex === 1) return <CodeBlock path="src/tool.ts" start={12} lines={READ_TOOL} />
    return <div className="pce-error">src/missing.ts was not found in the workspace.</div>
  }
  if (spec.id === 'file-mutation' && variantIndex === 2) {
    if (rowIndex === 0) {
      return <DiffBlock path="fixtures/a.txt" lines={[
        { kind: 'ctx', text: 'new file' }, { kind: 'add', text: 'fixture a' }, { kind: 'add', text: 'fixture b' },
      ]} />
    }
    if (rowIndex === 1) {
      return <DiffBlock path="src/handler.ts" lines={[{ kind: 'remove', text: '  respond(401)' }, { kind: 'add', text: "  respond(401, 'missing')" }]} />
    }
    return <div className="pce-error">locked.txt was not read this session.</div>
  }
  if (spec.id === 'bash' && variantIndex === 3) {
    return rowIndex === 0
      ? <Terminal lines={['$ pnpm lint', '✓ no lint errors', 'Duration 1.2s']} />
      : <Terminal lines={['$ pnpm test', '✓ 24 tests passed', 'Duration 12.4s']} />
  }
  return <ChatBody spec={spec} variantIndex={variantIndex} {...rest} />
}

function ToolTable(props: {
  readonly rows: readonly ArrayRow[]
  readonly column: string
  readonly selected: number | null
  readonly onSelect: (index: number) => void
}): ReactNode {
  return (
    <div className="pce-table pce-array pce-tool-table">
      <div className="pce-tr pce-thead">
        <span>STATE</span><span>{props.column}</span><span>DETAIL</span>
      </div>
      {props.rows.map((row, index) => {
        const isSelected = props.selected === index
        return (
          <div className={`pce-tr${isSelected ? ' is-selected' : ''}`} key={`${row.state}-${row.primary}`}>
            <button
              type="button"
              className="pce-row-hit"
              aria-label={`Preview ${row.primary}`}
              aria-expanded={isSelected}
              onClick={() => props.onSelect(index)}
            />
            <span className="pce-cell-state"><Rule3StatusIcon tone={row.tone} />{row.state}</span>
            <span className="pce-cell-primary">{row.primary}</span>
            <span className="pce-cell-detail">{row.detail}</span>
          </div>
        )
      })}
    </div>
  )
}

function ToolMasterDetail(props: ProposedChatElementProps & {
  readonly rows: readonly ArrayRow[]
  readonly column: string
}): ReactNode {
  const { rows, column, ...rest } = props
  const [selected, setSelected] = useState<number | null>(null)
  const row = selected === null ? null : rows[selected]
  const previewKind = rest.spec.id === 'read' ? 'Read' : rest.spec.id === 'file-mutation' ? 'Diff' : 'Terminal'
  return (
    <div className={`pce-tool-master${row ? ' is-preview-open' : ''}`}>
      <ToolTable
        rows={rows}
        column={column}
        selected={selected}
        onSelect={index => setSelected(current => current === index ? null : index)}
      />
      <div className={`pce-tool-preview${row ? '' : ' is-collapsed'}`} aria-hidden={row ? undefined : true}>
        {row && (
          <div className="pce-tool-preview-inner">
            <div className="pce-tool-preview-head">
              <span className="pce-tool-preview-kind">{previewKind}</span>
              <strong>{row.primary}</strong>
              <span className="pce-tool-preview-state"><Rule3StatusIcon tone={row.tone} />{row.state}</span>
              <button
                type="button"
                className="pce-tool-preview-close"
                aria-label="Close tool preview"
                onClick={() => setSelected(null)}
              >
                <Rule3CloseIcon />
              </button>
            </div>
            <div className="pce-tool-preview-body">
              <ToolDetail {...rest} rowIndex={selected!} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function ProposedChatElement(props: ProposedChatElementProps): ReactNode {
  const { spec, variant, primary, detail, mark, avatar, tone } = props
  const array = arrayRows(spec, props.variantIndex)
  const singleColumn = SINGLE_TOOL_TABLES[spec.id]
  const table = array ?? (singleColumn
    ? { column: singleColumn, rows: [{ tone, state: variant.label, primary: elementPrimary(spec, primary), detail }] }
    : null)
  const hideHeader = TEXT_IDS.has(spec.id)
  const collapsible = COLLAPSIBLE_IDS.has(spec.id)
  const [bodyOpen, setBodyOpen] = useState(!collapsible)
  const markNode = avatar !== null
    ? avatar
    : <Rule3ToolIcon tool={mark ?? 'generic'} />
  const header = (
    <>
      <span className={`pce-mark${mark === 'generic' ? ' is-generic' : ''}`}>{markNode}</span>
      <span className="pce-identity">
        <strong>{spec.title}</strong>
        <span>{elementPrimary(spec, primary)} · {detail}</span>
      </span>
      <span className={`pce-head-state is-${tone}`}>
        {tone === 'running' ? <PixelLoader size={10} mode="sweep" /> : <Rule3StatusIcon tone={tone} />}
        {variant.label}
      </span>
      {collapsible && <span className="pce-toggle" aria-hidden="true">{bodyOpen ? '−' : '+'}</span>}
    </>
  )
  return (
    <article className={`pce pce-${spec.id} pce-tone-${tone}`} aria-label={`${spec.title} redesigned chat element`}>
      {hideHeader ? null : collapsible ? (
        <button
          type="button"
          className="pce-head is-collapsible"
          aria-expanded={bodyOpen}
          onClick={() => setBodyOpen(value => !value)}
        >
          {header}
        </button>
      ) : (
        <div className="pce-head">{header}</div>
      )}
      {bodyOpen && table !== null && (
        <ToolMasterDetail {...props} rows={table.rows} column={table.column} />
      )}
      {bodyOpen && table === null && <div className="pce-body"><ChatBody {...props} /></div>}
    </article>
  )
}
