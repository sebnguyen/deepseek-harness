/**
 * Mermaid diagram rendering for ```mermaid fences. Unlike KaTeX's synchronous
 * `renderToString`, `mermaid.render()` is async (it measures text via the
 * DOM), so this is a stateful component rather than a plain value-to-React
 * mapping: it shows the raw fence as an ordinary CodeBlock first, then swaps
 * in the SVG once `render()` settles. A diagram that fails to parse (invalid
 * syntax, common in model output) stays on the CodeBlock fallback rather than
 * an empty or broken render.
 *
 * Three guards keep a transcript with many diagrams from overwhelming the
 * page: `useViewportActivation` defers starting the expensive parse/render
 * pipeline until the block actually scrolls into view (a fast scroll past a
 * long transcript otherwise mounts every diagram at once and fires all of
 * their work simultaneously); `enqueueMermaidRender` serializes every render
 * through one page-wide queue — `mermaid.render()` drives shared, process-
 * global internal state via a real DOM measurement pass, so running several
 * concurrently (several diagrams becoming visible in the same scroll) risks
 * corrupting each other's state, not just costing CPU; and `RENDER_TIMEOUT_MS`
 * bounds one diagram's wall-clock time so a pathologically slow layout can't
 * both hang its own render indefinitely and starve the queue for every other
 * diagram behind it. The race can only preempt work that yields the main
 * thread between awaits — a genuinely synchronous infinite loop inside
 * mermaid's layout engine blocks the whole page regardless (no timer fires
 * until synchronous execution returns), so this is a mitigation for slow
 * work, not a hard guarantee against every possible hang.
 *
 * Mermaid bakes literal colors into the SVG at render time — it does not
 * inherit the surrounding page's CSS. `ui-layout`'s ThemePresenter toggles
 * `data-ds-dark-theme` on `<body>` for both the built-in preference and a
 * live user switch (`boot-theme.ts`), so that attribute (not a media query,
 * which would miss a manual override) picks Mermaid's own matching stock
 * theme, and a MutationObserver re-renders already-settled diagrams if the
 * user flips the theme while one is on screen.
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import mermaid from 'mermaid'
import { CodeBlock } from './CodeBlock.tsx'
import { useViewportActivation } from './useViewportActivation.ts'
import css from './Mermaid.module.css'

const DARK_THEME_ATTRIBUTE = 'data-ds-dark-theme'

function isDarkTheme(): boolean {
  return typeof document !== 'undefined' && document.body.hasAttribute(DARK_THEME_ATTRIBUTE)
}

/** Track the live theme attribute; only changes when the user actually switches. */
function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(isDarkTheme)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const observer = new MutationObserver(() => { setDark(isDarkTheme()) })
    observer.observe(document.body, { attributes: true, attributeFilter: [DARK_THEME_ATTRIBUTE] })
    return () => { observer.disconnect() }
  }, [])
  return dark
}

/** Page-wide serialization: only one `mermaid.render()` pass runs at a time. */
let renderQueue: Promise<void> = Promise.resolve()

/** Wall-clock ceiling for one diagram's parse+render pass; see the module doc for what this can and can't preempt. */
const RENDER_TIMEOUT_MS = 8000

/** Race a promise against the shared render timeout. */
function withRenderTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`mermaid render exceeded ${RENDER_TIMEOUT_MS}ms`)) }, RENDER_TIMEOUT_MS)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error) },
    )
  })
}

/**
 * Run one render task after every previously queued task has settled,
 * regardless of whether it succeeded or failed, so one broken diagram never
 * jams the queue for the rest of the page.
 * @param task - the parse/render work to serialize.
 * @returns this task's own outcome, independent of the shared queue's bookkeeping.
 */
function enqueueMermaidRender<T>(task: () => Promise<T>): Promise<T> {
  const settled = renderQueue.then(task, task)
  renderQueue = settled.then(() => undefined, () => undefined)
  return settled
}

type State =
  | { kind: 'pending' }
  | { kind: 'rendered'; svg: string; bind?: (element: Element) => void }
  | { kind: 'error' }

export interface MermaidBlockProps {
  /** The diagram source, exactly as it appeared inside the fence. */
  code: string
  /** Forwarded to the fallback CodeBlock (pending state and parse errors). */
  copyLabel: string
  /** Forwarded to the fallback CodeBlock. */
  copiedLabel: string
}

export function MermaidBlock({ code, copyLabel, copiedLabel }: MermaidBlockProps): ReactNode {
  // mermaid ids must be a valid CSS/DOM identifier; useId() emits colons.
  const rawId = useId()
  const id = `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`
  const dark = useIsDarkTheme()
  const [state, setState] = useState<State>({ kind: 'pending' })
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const visible = useViewportActivation(wrapperRef)
  // Guards a render that settles after `code`/theme has already changed again.
  const generationRef = useRef(0)

  useEffect(() => {
    if (!visible) return
    const own = ++generationRef.current
    setState({ kind: 'pending' })
    void enqueueMermaidRender(async () => {
      if (generationRef.current !== own) return
      // Process-global config; cheap and idempotent, so setting it right
      // before each render keeps every diagram on the page consistent with
      // whichever theme is current right now. Applied inside the queue: two
      // diagrams on different themes (a stale re-render mid theme-switch)
      // must not race each other's `initialize()` call against their own
      // `render()`.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: dark ? 'dark' : 'default',
        themeVariables: { background: 'transparent' },
      })
      const parsed = await withRenderTimeout(mermaid.parse(code, { suppressErrors: true })).catch(() => false as const)
      if (generationRef.current !== own) return
      if (parsed === false) {
        setState({ kind: 'error' })
        return
      }
      try {
        const { svg, bindFunctions } = await withRenderTimeout(mermaid.render(id, code))
        if (generationRef.current !== own) return
        setState({ kind: 'rendered', svg, ...(bindFunctions === undefined ? {} : { bind: bindFunctions }) })
      } catch {
        if (generationRef.current === own) setState({ kind: 'error' })
      }
    })
    return () => { generationRef.current += 1 }
  }, [code, id, dark, visible])

  useEffect(() => {
    if (state.kind !== 'rendered' || containerRef.current === null) return
    state.bind?.(containerRef.current)
  }, [state])

  if (state.kind !== 'rendered') {
    return (
      <div ref={wrapperRef}>
        <CodeBlock code={code} lang="mermaid" copyLabel={copyLabel} copiedLabel={copiedLabel} />
      </div>
    )
  }
  // mermaid.render() returns a static SVG string it generated from `code` (no
  // user HTML passes through) — the same trust shiki's and KaTeX's output get.
  return (
    <div ref={wrapperRef}>
      <div ref={containerRef} className={css.diagram} dangerouslySetInnerHTML={{ __html: state.svg }} />
    </div>
  )
}
