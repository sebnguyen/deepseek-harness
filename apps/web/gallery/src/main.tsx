import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@theme/base.css'
import '@theme/corner-shape.css'
import '@theme/design-platform.css'
import '@theme/scrollbar.css'
import '@theme/gradient-shadow-text.css'
import '@theme/shiki.css'
import {
  Rule3CloseIcon, Rule3PreviewPanel, Rule3StatusIcon, Rule3ToolIcon, RuleThreeShowcase,
  RULE3_EXAMPLES, SPECIMENS, type PixelMark, type Rule3Row, type Rule3Tone, type Rule3Tool, type Specimen,
} from './specimens.tsx'
import { ProposedChatElement } from './proposed-chat.tsx'
import './gallery.css'

const GROUPS = [
  ['all', 'All surfaces'],
  ['chat', 'Chat rows'],
  ['tool', 'Tool views'],
  ['lifecycle', 'Lifecycle'],
  ['extension', 'Extensions'],
] as const

function isDark(): boolean {
  return document.body.hasAttribute('data-ds-dark-theme')
}

function setDark(dark: boolean): void {
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.documentElement.style.backgroundColor = getComputedStyle(document.body).backgroundColor
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard !== undefined && window.isSecureContext) {
    return navigator.clipboard.writeText(text)
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  area.remove()
  return Promise.resolve()
}

function useCopied(): [string | null, (id: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (copied === null) return
    const timer = window.setTimeout(() => setCopied(null), 1400)
    return () => window.clearTimeout(timer)
  }, [copied])
  return [copied, (id, text) => {
    void copyText(text).then(() => setCopied(id))
  }]
}

class RenderBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    return this.state.error === null
      ? this.props.children
      : <pre className="render-error">{this.state.error.stack ?? String(this.state.error)}</pre>
  }
}

function rule3ExampleTool(spec: Specimen): Rule3Tool | null {
  if (spec.id === 'read') return 'read'
  if (spec.id === 'file-mutation') return 'write'
  if (spec.id === 'bash') return 'bash'
  if (spec.id === 'tool-generic') return 'generic'
  return null
}

function proposedTone(label: string): Rule3Tone {
  if (/error|fail|interrupt|refus/i.test(label)) return 'error'
  if (/run|stream|loading|wait/i.test(label)) return 'running'
  return 'ok'
}

function proposedToneLabel(tone: Rule3Tone): string {
  return tone === 'ok' ? 'Done' : tone === 'error' ? 'Issue' : 'Running'
}

/* Every chat element gets a designated pixel mark. The Generic tool is the only
 * intentional fallback; attach, quiet-mode, thumb-up, thumb-down, folder-add and
 * clock are kept in the palette for surfaces that are not in this gallery yet. */
const SPEC_MARKS: Record<string, PixelMark> = {
  user: 'send',
  assistant: 'model-provider',
  steering: 'narrate-mode',
  'goal-input': 'send',
  context: 'context',
  'system-prompt': 'setting',
  reasoning: 'think',
  'tool-generic': 'generic',
  read: 'read',
  'file-mutation': 'write',
  bash: 'bash',
  search: 'internet',
  web: 'internet',
  todo: 'todo',
  ask: 'ask',
  'read-image': 'image-read',
  subcalls: 'fork',
  command: 'adjust',
  'manual-compaction': 'copy',
  compaction: 'folder-close',
  retry: 'reload',
  'turn-error': 'error',
  'max-tokens': 'token',
  'turn-tail': 'statistic',
  unknown: 'add',
  'step-boundary': 'pause',
  'workflow-run': 'fork',
  inbox: 'folder-open',
}

function pixelMarkForSpec(spec: Specimen): PixelMark {
  return SPEC_MARKS[spec.id] ?? 'generic'
}

type ProposedCopy = readonly [primary: string, detail: string, expandable?: boolean]

/* Actual row copy, rebuilt in the Rule 3 row language. */
const PROPOSED_COPY: Record<string, readonly ProposedCopy[]> = {
  user: [
    ['How do I add a tool to the registry? I want the schema and the handler in one place.', 'direct'],
    ['Review @src/main.ts and @AGENTS.md before the change. Keep the patch small.', 'references · direct'],
    ['While you are there, also check the empty state.', 'steering'],
  ],
  context: [
    ['Context injection', 'AGENTS.md · instructions', true],
    ['Context injection', 'mcp-server · opaque', true],
    ['Context injection', 'Research session · recall', true],
  ],
  assistant: [
    ['Tools are registered with `defineTool`. The schema is a Zod object, and the handler receives the parsed input.', 'markdown', true],
    ['Register the tool with its input schema.', 'code', true],
    ['The handler is parsing the workspace now', 'streaming', true],
    ['The handler was stopped before it could finish the write.', 'interrupted', true],
  ],
  reasoning: [
    ['The registry already has a grep tool, so I should read its schema before adding a second one.', 'Finished', true],
    ['Checking the existing tool contract first', 'Thinking', true],
  ],
  'system-prompt': [
    ['System prompt', 'AGENTS.md · collapsed', true],
  ],
  'tool-generic': [
    ['run_code', 'running', true],
    ['run_code', 'verified 12 files', true],
    ['run_code', 'verification failed: 2 files changed', true],
  ],
  bash: [
    ['pnpm test', 'running', true],
    ['pnpm test', '24 tests passed · 12.41s', true],
    ['pnpm test', 'FAIL src/main.test.ts', true],
    ['lint and test', '2 commands', true],
  ],
  read: [
    ['src/main.ts', '3 lines · ts', true],
    ['src/main.ts, src/tool.ts +1', '3 files', true],
    ['src/huge.ts', 'lines 120–122 of 2,480', true],
  ],
  'file-mutation': [
    ['src/tool.ts', 'write · +3 -0', true],
    ['src/tool.ts', 'return 1 → return 2', true],
    ['fixtures/a.txt +2', '3 files · 1 skipped', true],
  ],
  search: [
    ['defineTool', '1 match · src/tool.ts:14', true],
    ['src/**/*.ts', '3 files', true],
  ],
  web: [
    ['React CSS modules', '2 sources', true],
    ['https://react.dev', 'fetched', true],
  ],
  todo: [
    ['Read the existing tool +2', '1 of 3 active', true],
  ],
  ask: [
    ['Which database should the demo use?', 'awaiting answer', true],
    ['Which database should the demo use?', 'Postgres', true],
  ],
  'read-image': [
    ['docs/arch.png', 'image input refused', true],
  ],
  subcalls: [
    ['run_code', '2 subcalls · inspected 3 files', true],
  ],
  command: [
    ['Plan mode', 'Entered plan mode.'],
    ['Plan mode', 'Plan mode is already active.'],
    ['Compact', 'running'],
  ],
  'manual-compaction': [
    ['Compact', 'checkpoint settled'],
  ],
  compaction: [
    ['Compaction', 'checkpoint summary'],
  ],
  retry: [
    ['Provider retry', 'rate limit · retry scheduled'],
    ['Provider retry', 'retry started'],
  ],
  'turn-error': [
    ['RATE_LIMIT', 'provider 429 after 3 attempts'],
  ],
  'max-tokens': [
    ['Output limit', 'max tokens reached'],
  ],
  'turn-tail': [
    ['Turn settled', 'token usage and duration'],
  ],
  unknown: [
    ['future/surface', 'unknown node'],
  ],
  steering: [
    ['Also check the keyboard path while the turn is still running.', 'steering'],
  ],
  'step-boundary': [
    ['Step start', 'no transcript row'],
    ['Step end', 'no transcript row'],
  ],
  'workflow-run': [
    ['review', '2 phases · 1 running', true],
    ['review', '1 phase · completed', true],
  ],
  inbox: [
    ['Inbox next step', 'state only'],
  ],
  'goal-input': [
    ['/goal ship the real component gallery', 'command input'],
  ],
}

function Card(props: {
  spec: Specimen
  index: number
  initialVariant: number
  proposed?: boolean
  activeVariant?: number
  onVariantChange?: (index: number) => void
}) {
  const proposed = props.proposed === true
  const exampleTool = proposed ? rule3ExampleTool(props.spec) : null
  const ruleExample = exampleTool === null ? undefined : RULE3_EXAMPLES.find(item => item.id === exampleTool)
  const iconTool = exampleTool ?? (props.spec.group === 'tool' ? 'generic' : null)
  const [ruleRow, setRuleRow] = useState<Rule3Row | null>(() => ruleExample?.rows[0] ?? null)
  const [ownActive, setOwnActive] = useState(props.initialVariant)
  const active = props.activeVariant ?? ownActive
  const setActive = (index: number) => {
    if (props.onVariantChange !== undefined) props.onVariantChange(index)
    else setOwnActive(index)
  }
  const [showMarkup, setShowMarkup] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const [copied, markCopied] = useCopied()
  const variant = props.spec.variants[active] ?? props.spec.variants[0]
  const markup = useMemo(() => stage.current?.innerHTML ?? '', [showMarkup, active, ruleRow])

  const footer = (
    <footer className="card-foot">
      <span className="real-badge">
        <span className="real-dot" />{proposed ? 'Proposed demo' : 'Real component'}
      </span>
      <div className="card-actions">
        <button type="button" className="ghost-button" onClick={() => setShowMarkup(value => !value)}>
          {showMarkup ? 'Hide markup' : 'View markup'}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => markCopied(props.spec.id, stage.current?.innerHTML ?? '')}
        >
          {copied === props.spec.id ? 'Copied' : 'Copy HTML'}
        </button>
      </div>
    </footer>
  )

  const proposedColumns = ruleExample?.columns ?? ['State', 'Variant', 'Detail']
  const proposedRows = ruleExample
    ? ruleExample.rows.map((row, i) => ({
      key: `${row.primary}-${row.state}-${i}`,
      state: row.state,
      tone: row.tone,
      primary: row.primary,
      detail: row.detail,
      selected: ruleRow === row,
      onSelect: () => setRuleRow(row),
    }))
    : props.spec.variants.map((item, i) => {
      const tone = proposedTone(item.label)
      return {
        key: `${item.label}-${i}`,
        state: proposedToneLabel(tone),
        tone,
        primary: item.label,
        detail: props.spec.component,
        selected: i === active,
        onSelect: () => setActive(i),
      }
    })

  return (
    <article
      className={`card${proposed ? ' proposed-card' : ''}`}
      id={proposed ? `spec-proposed-${props.spec.id}` : `spec-${props.spec.id}`}
      data-group={props.spec.group}
    >
      {proposed
        ? (
          <>
            <header className="proposed-head">
              {iconTool !== null && (
                <span className="proposed-icon" data-tool={iconTool}><Rule3ToolIcon tool={iconTool} /></span>
              )}
              <span className="proposed-index">{String(props.index + 1).padStart(2, '0')}</span>
              <span className="proposed-kind">{props.spec.kind}</span>
              <span className="proposed-component">{props.spec.component}</span>
              <span className="proposed-states">{props.spec.variants.length} {props.spec.variants.length === 1 ? 'state' : 'states'}</span>
            </header>
            <div className="proposed-copy">
              <h2>{props.spec.title}</h2>
              <p className="blurb">{props.spec.blurb}</p>
            </div>
            <div className="proposed-table" role="table" aria-label={`${props.spec.title} rows`}>
              <div className="proposed-tr proposed-thead" role="row">
                {proposedColumns.map(column => (
                  <span className="proposed-cell" role="columnheader" key={column}>{column}</span>
                ))}
              </div>
              {proposedRows.map(row => (
                <div
                  className={`proposed-tr proposed-${row.tone}${row.selected ? ' is-selected' : ''}`}
                  role="row"
                  key={row.key}
                >
                  <span className="proposed-cell proposed-state" role="cell">
                    <Rule3StatusIcon tone={row.tone} /><span>{row.state}</span>
                  </span>
                  <span className="proposed-cell proposed-primary" role="cell">
                    <button
                      type="button"
                      className="proposed-row-hit"
                      onClick={row.onSelect}
                      aria-label={`Preview ${row.primary}`}
                      aria-pressed={row.selected}
                    />
                    <span className="proposed-row-text" title={row.primary}>{row.primary}</span>
                  </span>
                  <span className="proposed-cell proposed-detail" role="cell" title={row.detail}>{row.detail}</span>
                </div>
              ))}
            </div>
            {ruleExample
              ? (
                <div className="proposed-preview proposed-tool-preview" ref={stage}>
                  {ruleRow
                    ? <Rule3PreviewPanel key={`${ruleRow.primary}-${ruleRow.state}`} row={ruleRow} onClose={() => setRuleRow(null)} />
                    : (
                      <div className="proposed-preview-empty">
                        {iconTool !== null && <Rule3ToolIcon tool={iconTool} />}
                        <p>Select a row for the real preview.</p>
                      </div>
                    )}
                </div>
              )
              : (
                <div className="proposed-preview" ref={stage}>
                  <div className="proposed-preview-head">
                    <span className="proposed-preview-kind">Preview</span>
                    <strong className="proposed-preview-name">{props.spec.title}</strong>
                    <span className="proposed-preview-state">
                      <span className="proposed-preview-dot" aria-hidden="true">·</span>{variant?.label}
                    </span>
                  </div>
                  <div className="stage stage-proposed" data-spec-id={props.spec.id}>
                    <div className="stage-inner">
                      <div className="real-chat" key={`${props.spec.id}:${active}`}>
                        <RenderBoundary>{variant?.render()}</RenderBoundary>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            {footer}
          </>
        )
        : (
          <>
            <header className="card-head">
              <div className="card-kicker">
                <span className="kind-chip">{props.spec.kind}</span>
                <span className="component-name">{props.spec.component}</span>
              </div>
              <span className="index">{String(props.index + 1).padStart(2, '0')}</span>
            </header>
            <div className="card-title-row">
              <h2>{props.spec.title}</h2>
              <span className="state-count">{props.spec.variants.length} {props.spec.variants.length === 1 ? 'state' : 'states'}</span>
            </div>
            <p className="blurb">{props.spec.blurb}</p>
            <div className="variant-tabs" role="tablist" aria-label={`${props.spec.title} states`}>
              {props.spec.variants.map((item, i) => (
                <button
                  key={item.label}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  className={`variant-tab${i === active ? ' is-active' : ''}`}
                  onClick={() => setActive(i)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="stage stage-current" ref={stage} data-spec-id={props.spec.id}>
              <div className="stage-inner">
                <div className="real-chat" key={`${props.spec.id}:${active}`}>
                  <RenderBoundary>{variant?.render()}</RenderBoundary>
                </div>
              </div>
            </div>
            {footer}
          </>
        )}
      {showMarkup && (
        <pre className="markup" aria-label={`${props.spec.title} rendered markup`}>
          {markup || 'The real component rendered no DOM for this state.'}
        </pre>
      )}
      {props.spec.note !== undefined && <p className="spec-note">{props.spec.note}</p>}
    </article>
  )
}

function ComparePair(props: { readonly spec: Specimen; readonly index: number; readonly initialVariant: number }): ReactNode {
  const [active, setActive] = useState(props.initialVariant)
  return (
    <div className="compare-pair" role="group" aria-label={`${props.spec.title} comparison`}>
      <Card
        spec={props.spec}
        index={props.index}
        initialVariant={props.initialVariant}
        activeVariant={active}
        onVariantChange={setActive}
        proposed
      />
      <Card
        spec={props.spec}
        index={props.index}
        initialVariant={props.initialVariant}
        activeVariant={active}
        onVariantChange={setActive}
      />
    </div>
  )
}

interface StateRow {
  readonly spec: Specimen
  readonly variant: Specimen['variants'][number]
  readonly specIndex: number
  readonly variantIndex: number
}

function ProposedRow(props: { readonly row: StateRow }): ReactNode {
  const { spec, variant, specIndex, variantIndex } = props.row
  const copy = PROPOSED_COPY[spec.id]?.[variantIndex] ?? [spec.title, variant.label] as const
  const [primary, detail] = copy
  const [open, setOpen] = useState(true)
  const icon = pixelMarkForSpec(spec)
  const tone = proposedTone(variant.label)
  const number = `${String(specIndex + 1).padStart(2, '0')}.${variantIndex + 1}`
  return (
    <div className={`proposed-line${open ? '' : ' is-closed'}`}>
      <button
        type="button"
        className="proposed-line-head"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className="proposed-line-top">
          <span className="proposed-line-icon" data-mark={icon}><Rule3ToolIcon tool={icon} /></span>
          <span className="proposed-line-state"><Rule3StatusIcon tone={tone} />{variant.label}</span>
          <span className="proposed-line-index">{number}</span>
        </span>
        <span className="proposed-line-primary">{spec.title}</span>
        <span className="proposed-line-detail">{detail}</span>
      </button>
      <div className="proposed-line-preview" aria-hidden={open ? undefined : true}>
        {open && (
          <>
            <div className="proposed-line-preview-head">
              <span className="preview-tag is-redesign">Redesign</span>
              <span className="proposed-line-preview-kind">Chat element</span>
              <strong>{spec.title}</strong>
              <span className="preview-state"><Rule3StatusIcon tone={tone} />{variant.label}</span>
              <button
                type="button"
                className="proposed-line-close"
                aria-label="Close proposed preview"
                onClick={() => setOpen(false)}
              >
                <Rule3CloseIcon />
              </button>
            </div>
            <div className="proposed-line-preview-body">
              <ProposedChatElement
                spec={spec}
                variant={variant}
                variantIndex={variantIndex}
                primary={primary}
                detail={detail}
                mark={icon}
                avatar={null}
                tone={tone}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function CurrentRow(props: { readonly row: StateRow }): ReactNode {
  const { spec, variant, specIndex, variantIndex } = props.row
  const tone = proposedTone(variant.label)
  return (
    <div className="current-line">
      <div className="current-line-head">
        <span className="preview-tag is-current">Current</span>
        <span className="preview-kind">{spec.kind}</span>
        <span className="current-line-component">{spec.component}</span>
        <span className="preview-state"><Rule3StatusIcon tone={tone} />{variant.label}</span>
        <span className="current-line-index">{String(specIndex + 1).padStart(2, '0')}.{variantIndex + 1}</span>
      </div>
      <div className="current-line-body">
        <div className="real-chat" key={`${spec.id}:${variantIndex}`}>
          <RenderBoundary>{variant.render()}</RenderBoundary>
        </div>
      </div>
    </div>
  )
}

function StateComparison(props: { readonly row: StateRow }): ReactNode {
  const { spec, variant } = props.row
  return (
    <div className="compare-row-pair" role="group" aria-label={`${spec.title} ${variant.label} comparison`}>
      <ProposedRow row={props.row} />
      <CurrentRow row={props.row} />
    </div>
  )
}

function App() {
  const [dark, setDarkState] = useState(() => isDark())
  const [group, setGroup] = useState<(typeof GROUPS)[number][0]>('all')
  const [copied, markCopied] = useCopied()
  const specs = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const only = params.get('only')
    const limit = Number(params.get('limit') ?? '0')
    const filtered = SPECIMENS.filter(spec =>
      (group === 'all' || spec.group === group) && (only === null || spec.id === only))
    return limit > 0 ? filtered.slice(0, limit) : filtered
  }, [group])
  const stateCount = SPECIMENS.reduce((total, spec) => total + spec.variants.length, 0)
  const kindCount = new Set(SPECIMENS.map(spec => spec.kind)).size
  const rows = useMemo<StateRow[]>(() => specs.flatMap((spec, specIndex) => (
    spec.variants.map((variant, variantIndex) => ({ spec, variant, specIndex, variantIndex }))
  )), [specs])

  useEffect(() => { setDark(dark) }, [dark])

  const openDisclosures = (): void => {
    document.querySelectorAll<HTMLElement>('#gallery [data-disclosure-row], #gallery [data-expandable]').forEach((row) => {
      if (row.getAttribute('aria-expanded') === 'false') row.click()
    })
  }

  const copyAll = (): void => {
    const markup = [...document.querySelectorAll<HTMLElement>('.current-line-body')]
      .map(stage => `<!-- ${stage.dataset.specId} -->\n${stage.innerHTML}`)
      .join('\n\n')
    markCopied('all', markup)
  }

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot" />Mounted from source, not rebuilt</div>
          <h1>The real UI node gallery<span className="stop">.</span></h1>
          <p className="lede">
            Every stage below is the actual React component from <code>packages/client</code>, rendered with its own
            CSS Modules, i18n strings and tool dispatcher. The page chrome is the only new styling.
          </p>
          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={openDisclosures}>Open all disclosures</button>
            <button type="button" className="secondary-button" onClick={copyAll}>
              {copied === 'all' ? 'Copied all markup' : 'Copy all rendered HTML'}
            </button>
          </div>
        </div>
        <aside className="hero-panel" aria-label="Gallery facts">
          <div className="fact"><strong>{SPECIMENS.length}</strong><span>specimens</span></div>
          <div className="fact"><strong>{stateCount}</strong><span>real states</span></div>
          <div className="fact"><strong>{kindCount}</strong><span>node kinds</span></div>
          <div className="theme-row">
            <span>Theme</span>
            <div className="theme-switch" role="group" aria-label="Theme">
              <button type="button" aria-pressed={!dark} onClick={() => setDarkState(false)}>Light</button>
              <button type="button" aria-pressed={dark} onClick={() => setDarkState(true)}>Dark</button>
            </div>
          </div>
        </aside>
      </header>

      <section className="note-strip">
        <strong>Why this is different:</strong> the previous page approximated the nodes with hand-written CSS. This page
        imports <code>UserMessageNodeView</code>, <code>AssistantNodeView</code>, <code>ToolCallTree</code>, the keyed
        toolviews and their real stylesheets. Open a disclosure, switch a state, or copy the rendered DOM to inspect what
        the product actually paints.
        <span className="scope-note">Scope: the main <code>deepseek-harness</code> client packages. The Cordis rows
          (<code>cordis_define</code>, <code>cordis_run</code>, <code>cordis_stop</code>, <code>cordis_undefine</code>) ship
          only in <code>deepseek-harness-prod</code>, so they are not mounted here.</span>
      </section>

      <RuleThreeShowcase />

      <section className="compare" aria-labelledby="compare-title">
        <div className="compare-head">
          <div className="compare-copy">
            <div className="compare-kicker">Propose + current</div>
            <h2 className="compare-title" id="compare-title">The actual row, in Rule 3.</h2>
            <p className="compare-lede">
              One state row per assistant state. The preview on the left is the chat element itself, rebuilt with the
              Rule 3 state/file/detail table and pixel marks; the right keeps the current chat element.
            </p>
          </div>
          <nav className="filters compare-filters" aria-label="Filter specimens">
            {GROUPS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`filter${group === id ? ' is-active' : ''}`}
                aria-pressed={group === id}
                onClick={() => setGroup(id)}
              >
                {label}
                <span>{id === 'all' ? SPECIMENS.length : SPECIMENS.filter(spec => spec.group === id).length}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="compare-column-heads">
          <div className="compare-column-head">
            <span className="compare-label">Proposed</span>
            <span className="compare-count">{rows.length} states</span>
          </div>
          <div className="compare-column-head">
            <span className="compare-label">Current</span>
            <span className="compare-count">{rows.length} states</span>
          </div>
        </div>

        <div className="compare-rows" id="gallery">
          {rows.map(row => (
            <StateComparison key={`${row.spec.id}:${row.variantIndex}`} row={row} />
          ))}
        </div>
      </section>

      <footer className="page-foot">
        <span>DeepSeek Harness · client UI source</span>
        <span>React 18 · real CSS Modules · real tool slot dispatch · structured tool summaries</span>
      </footer>
    </div>
  )
}

setDark(isDark())
createRoot(document.getElementById('root')!).render(<App />)
