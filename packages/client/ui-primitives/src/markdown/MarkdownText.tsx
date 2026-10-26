/**
 * Untrusted assistant-Markdown renderer over the direct mdast pipeline:
 * `parse.ts` grammars, the incremental streaming parser, and `render.tsx`.
 * While a message streams, all but the trailing block freeze as cached React
 * elements and only the source tail behind them re-parses per chunk, so
 * per-chunk work tracks the tail size instead of the whole reply. Only frozen
 * blocks render: the trailing block is the one the model is still writing, so it
 * mounts when the reply ends (or when a later block pushes it out of the tail)
 * rather than showing unfrozen text. A reveal cursor sweeps the frozen text at a
 * fixed cadence rather than at the network's: blocks it has passed are cached
 * settled elements, the block it sits in renders as its revealed prefix, and
 * everything ahead of it stays veiled, so the arrival rate is ours to control
 * instead of the model's.
 * Frozen blocks keep their source-offset keys when they cross the freeze
 * boundary, so React reconciles instead of remounting. Known deviation while
 * streaming: a reference-style link or footnote whose definition sits on the
 * other side of the freeze boundary renders literally until the settled
 * full parse self-heals it.
 */

import { memo, useEffect, useMemo, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'
import { IncrementalMarkdownParser } from './incremental.ts'
import type { PositionedBlock } from './incremental.ts'
import { parseGfm, parseGfmWithMath } from './parse.ts'
import {
  collectReferenceTargets, createReferenceTargets, renderBlocks, renderFootnoteSection,
  wrapBlockChildren,
} from './render.tsx'
import type { MarkdownFileMentions, MarkdownLabels, MarkdownPathImages, MarkdownRenderContext, MarkdownTailRun, ReferenceTargets } from './render.tsx'
import 'katex/dist/katex.min.css'
import css from './MarkdownText.module.css'

export type { MarkdownCodeLabels, MarkdownFileMentions, MarkdownLabels, MarkdownPathImages } from './render.tsx'

/** One settled full render: parse with math, resolve references, append the footnote section. */
function renderSettled(
  text: string,
  labels: MarkdownLabels,
  fileMentions: MarkdownFileMentions | undefined,
  pathImages: MarkdownPathImages | undefined,
): ReactNode[] {
  const root = parseGfmWithMath(text)
  const targets = createReferenceTargets()
  collectReferenceTargets(root.children, targets)
  const context: MarkdownRenderContext = {
    streaming: false,
    labels,
    fileMentions,
    pathImages,
    targets,
    footnoteOrder: [],
    footnoteCounts: new Map(),
  }
  const blocks = wrapBlockChildren(
    renderBlocks(root.children.map((node, index) => ({
      node,
      /* v8 ignore next -- parseFull uses parseGfm, which stamps every top-level node. */
      key: node.position?.start.offset ?? -(index + 1),
    })), context),
    false,
  )
  const section = renderFootnoteSection(context)
  return section === null ? blocks : [...blocks, '\n', section]
}

/** Reveal cadence: one tick, and the characters it normally carries. */
const REVEAL_TICK_MS = 40
const REVEAL_STEP = 5
/** A backlog drains over this many ticks, capped so the reveal never crawls. */
const REVEAL_CATCHUP_TICKS = 6
const REVEAL_MAX_STEP = 24
/** Mark window in ticks; matches the swell's duration so no span is cut short. */
const TAIL_WINDOW_TICKS = 6

/**
 * Absolute source end of a block: its key plus its parsed span. A position-less
 * parse cannot be cut, so it never settles and stays the cursor's block.
 * @param block - One block of the pass.
 * @returns The block's absolute end offset.
 */
function blockEnd(block: PositionedBlock): number {
  const start = block.node.position?.start.offset
  const end = block.node.position?.end.offset
  /* v8 ignore next -- real grammars stamp positions; a position-less parse keeps the block live. */
  if (start === undefined || end === undefined) return Number.POSITIVE_INFINITY
  return block.key + (end - start)
}

/**
 * Streaming render state for one growing message: the incremental parser,
 * the frozen blocks' cached elements, and the reference/footnote state their
 * rendering consumed (footnote numbering assigned to frozen references is
 * final, so the tail continues from a copy of it each frame).
 */
class StreamingRenderer {
  private readonly parser = new IncrementalMarkdownParser(parseGfm)
  private generation = -1
  private frozenElements: ReactNode[] = []
  private frozenTargets: ReferenceTargets = createReferenceTargets()
  private frozenFootnoteOrder: string[] = []
  private frozenFootnoteCounts = new Map<string, number>()
  private lastText: string | null = null
  private lastTailFrom: number | undefined
  /** Whether the owner reported the buffer final; then the tail joins the replay. */
  private final = false
  private lastFinal = false
  private lastRendered: ReactNode[] = []
  /** One run per replay tick still animating; each keeps its own span. */
  private tailRuns: MarkdownTailRun[] = []
  private frozen: readonly PositionedBlock[] = []
  private tail: readonly PositionedBlock[] = []
  /** Blocks the reveal cursor has fully passed, already cached as elements. */
  private settledCount = 0
  /** Absolute source offset the replay has revealed up to. */
  private revealed = 0
  /** Bumped whenever the reveal changes, so the render guard can tell. */
  private revision = 0
  private lastRevision = -1

  /** @param labels - Localized chrome baked into cached elements. */
  /** @param paced - False renders the whole buffer at once (reduced motion, tests). */
  constructor(private readonly labels: MarkdownLabels, private readonly paced = true) {}

  /** Absolute source offset the reveal has reached; unpaced renders everything. */
  private revealedNow(): number {
    return this.paced ? this.revealed : Number.MAX_SAFE_INTEGER
  }

  /**
   * Whether the parser's trailing block belongs in the frame. It does once the
   * buffer is final, and always in unpaced mode, where there is nothing to pace
   * and the caller wants the rendered result.
   */
  private tailVisible(): boolean {
    return this.final || !this.paced
  }

  /**
   * Render the reveal cursor's current position. Idempotent per text value and
   * cursor position, so React may re-execute the calling render freely.
   * @param text - The full accumulated markdown source.
   * @param tailFrom - Full-source offset where this chunk's new characters
   * begin. It only decides which blocks stay unstable for the parser; the
   * animation follows the reveal cursor instead of the network.
   * @param final - Whether the buffer is final (the reply stopped streaming). The
   * parser never freezes the last block while the document can still grow, so
   * until this is set that block is not rendered at all; once it is, the trailing
   * block joins the replay like any frozen block instead of popping in whole.
   * @returns Revealed elements, the cursor's block, and the footnote section.
   */
  render(text: string, tailFrom?: number | undefined, final = false): ReactNode[] {
    this.final = final
    if (
      text === this.lastText && tailFrom === this.lastTailFrom
      && final === this.lastFinal && this.revision === this.lastRevision
    ) return this.lastRendered
    const revealed = this.revealedNow()
    const { frozen, tail, generation } = this.parser.update(text, tailFrom)
    if (generation !== this.generation) {
      this.generation = generation
      this.settledCount = 0
      this.frozenElements = []
      this.frozenTargets = createReferenceTargets()
      this.frozenFootnoteOrder = []
      this.frozenFootnoteCounts = new Map()
      this.tailRuns = []
      this.revealed = Math.min(this.revealed, text.length)
    }
    this.frozen = frozen
    this.tail = tail
    const unsettled = frozen.slice(this.settledCount)
    // Definitions from a block settle this frame must be known before its
    // element is built, so a reference in it resolves on the same pass.
    collectReferenceTargets(
      unsettled.filter(block => blockEnd(block) <= revealed).map(block => block.node),
      this.frozenTargets,
    )
    // Targets visible this frame: every block still at or ahead of the cursor
    // plus the tail parse, so a link resolves against the tree its definition
    // came from even while the definition is still veiled.
    const frameTargets: ReferenceTargets = {
      definitions: new Map(this.frozenTargets.definitions),
      footnotes: new Map(this.frozenTargets.footnotes),
    }
    collectReferenceTargets(
      [...unsettled.map(block => block.node), ...tail.map(block => block.node)],
      frameTargets,
    )
    // Blocks the cursor has fully passed are final: drop their marks, cache the
    // element, and let the next block start. Nothing ahead of the cursor renders.
    let settling = frozen[this.settledCount]
    while (settling !== undefined && blockEnd(settling) <= revealed) {
      const block = settling
      this.settledCount += 1
      const settledContext: MarkdownRenderContext = {
        streaming: true,
        labels: this.labels,
        fileMentions: undefined,
        pathImages: undefined,
        targets: frameTargets,
        footnoteOrder: this.frozenFootnoteOrder,
        footnoteCounts: this.frozenFootnoteCounts,
      }
      // Separator newlines are cached alongside the elements so the assembled
      // children match the settled pipeline's block wrapping.
      const batch = [...this.frozenElements]
      if (batch.length > 0) batch.push('\n')
      batch.push(...renderBlocks([block], settledContext))
      this.frozenElements = batch
      settling = frozen[this.settledCount]
    }
    // Keep a window of completed ticks so every span finishes its swell before
    // the next tick drops it instead of being cut mid-animation.
    this.tailRuns = this.tailRuns.slice(-TAIL_WINDOW_TICKS)
    const children = [...this.frozenElements]
    let section: ReactNode = null
    // Only frozen blocks render while the reply is live: the tail is the block
    // the model is still typing, and mounting it would put unfrozen text on
    // screen. A final buffer has no tail in that sense, so it joins at the end.
    const pending = this.tailVisible()
      ? [...this.frozen.slice(this.settledCount), ...this.tail]
      : this.frozen.slice(this.settledCount)
    if (pending.length === 0) {
      section = renderFootnoteSection({
        streaming: true,
        labels: this.labels,
        fileMentions: undefined,
        pathImages: undefined,
        targets: frameTargets,
        footnoteOrder: this.frozenFootnoteOrder,
        footnoteCounts: this.frozenFootnoteCounts,
      })
    } else {
      const cursorContext: MarkdownRenderContext = {
        streaming: true,
        labels: this.labels,
        fileMentions: undefined,
        pathImages: undefined,
        targets: frameTargets,
        footnoteOrder: [...this.frozenFootnoteOrder],
        footnoteCounts: new Map(this.frozenFootnoteCounts),
        tailRuns: this.tailRuns,
      }
      for (const element of renderBlocks(pending, cursorContext, revealed)) {
        if (children.length > 0) children.push('\n')
        children.push(element)
      }
      section = renderFootnoteSection(cursorContext)
    }
    if (section !== null) children.push('\n', section)
    this.lastText = text
    this.lastTailFrom = tailFrom
    this.lastFinal = final
    this.lastRevision = this.revision
    this.lastRendered = children
    return this.lastRendered
  }

  /**
   * Advance the reveal one tick. While text is pending the step covers the
   * backlog over {@link REVEAL_CATCHUP_TICKS} ticks, so a burst drains without
   * the reveal ever moving faster than {@link REVEAL_MAX_STEP} characters per
   * tick; once everything is revealed the remaining spans expire one per tick,
   * so the last swell finishes instead of being dropped mid-animation.
   * @returns Whether anything changed, in which case the caller re-renders.
   */
  advance(): boolean {
    if (!this.paced) return false
    const frontier = this.frontier()
    const backlog = frontier - this.revealed
    if (backlog <= 0) {
      if (this.tailRuns.length === 0) return false
      this.tailRuns.shift()
      this.revision += 1
      return true
    }
    const from = this.revealed
    const step = Math.min(REVEAL_MAX_STEP, Math.max(REVEAL_STEP, Math.ceil(backlog / REVEAL_CATCHUP_TICKS)))
    // The run is exactly the characters this tick added: clamping the cursor to
    // the frontier must not widen it backwards over the previous tick.
    this.revealed = Math.min(frontier, from + step)
    this.tailRuns.push({ start: from, end: this.revealed })
    this.revision += 1
    return true
  }

  /** Whether every received character is revealed and nothing is animating. */
  drained(): boolean {
    return !this.paced || (this.revealed >= this.frontier() && this.tailRuns.length === 0)
  }

  /**
   * Absolute end of the revealable text: the last frozen block, plus the trailing
   * block once the buffer is final. The cursor never runs past this, so a block
   * that has not frozen cannot be revealed ahead of its own mount.
   */
  private frontier(): number {
    const last = this.tailVisible()
      ? this.tail[this.tail.length - 1] ?? this.frozen[this.frozen.length - 1]
      : this.frozen[this.frozen.length - 1]
    return last === undefined ? 0 : blockEnd(last)
  }
}

/**
 * Render untrusted assistant-authored Markdown as semantic React elements.
 * @param props - Markdown source text preserved by the session projection;
 * `streaming` parses incrementally across chunks and highlights fences as
 * they grow (each fence re-tokenizes only appended text; TeX stays literal
 * until the finalize swap so incomplete formulae never flash errors);
 * `labels` forwards localized fence and footnote chrome — pass a
 * reference-stable object (memoized per locale revision), because a new
 * identity discards the streaming render cache mid-message. `fileMentions`
 * links inline-code tokens its resolver recognizes as real files, and
 * `pathImages` rewrites image destinations that are local file paths into
 * displayable URLs its resolver vouches for; both vocabularies are the
 * single streaming gate — they apply to settled renders only, because a
 * streaming message's vocabulary is not final and frozen cached elements
 * must not bake in handlers that could go stale. `reveal` selects how received
 * text reaches the screen while streaming: `paced` (the default) sweeps it at a
 * fixed cadence through spans that animate, `immediate` renders the whole buffer
 * at once with no marks — the right mode for reduced motion, and for callers
 * that only need the rendered result.
 * @returns A GFM document with TeX math rendered through KaTeX; raw HTML,
 * relative links, and unsafe protocols are disabled, while absolute HTTP(S)
 * images render directly.
 */
export const MarkdownText = memo(function MarkdownText({ text, streaming = false, tailFrom, reveal = 'paced', labels, fileMentions, pathImages }: {
  text: string
  streaming?: boolean
  /**
   * Streaming only: source offset in `text` where the characters that arrived
   * in this chunk begin. It decides which blocks stay unstable for the parser;
   * the animation follows the reveal cursor, not the chunk boundary. Undefined on
   * settled renders and on blocks that are not the live tail.
   */
  tailFrom?: number | undefined
  /**
   * Streaming only: `paced` (default) reveals received text at a fixed cadence
   * with an animated span per tick; `immediate` renders the whole buffer at once
   * with no marks, which is what reduced-motion users and render-only callers
   * want.
   */
  reveal?: 'paced' | 'immediate'
  labels: MarkdownLabels
  fileMentions?: MarkdownFileMentions | undefined
  pathImages?: MarkdownPathImages | undefined
}) {
  const streamRef = useRef<StreamingRenderer | null>(null)
  const streamLabelsRef = useRef<MarkdownLabels>(labels)
  const streamRevealRef = useRef(reveal)
  const [revision, tick] = useReducer((count: number) => count + 1, 0)
  const children = useMemo(() => {
    let renderer = streamRef.current
    if (!streaming && renderer === null) return renderSettled(text, labels, fileMentions, pathImages)
    if (renderer === null || streamLabelsRef.current !== labels || streamRevealRef.current !== reveal) {
      renderer = new StreamingRenderer(labels, reveal === 'paced')
      streamRef.current = renderer
      streamLabelsRef.current = labels
      streamRevealRef.current = reveal
    }
    // The renderer has to see the final flag before it can say it has drained:
    // while the buffer could still grow, the trailing block is not in the replay
    // at all, so draining early would settle the reply and skip its sweep.
    const frame = renderer.render(text, tailFrom, !streaming)
    if (!streaming && renderer.drained()) {
      streamRef.current = null
      return renderSettled(text, labels, fileMentions, pathImages)
    }
    return frame
  }, [text, streaming, tailFrom, reveal, labels, fileMentions, pathImages, revision])
  // The reveal is on our clock, not the network's: while anything is still
  // veiled the cursor ticks forward, so the arrival rate stays constant no
  // matter how bursty the model is.
  const replaying = reveal === 'paced' && (streaming || (streamRef.current !== null && !streamRef.current.drained()))
  useEffect(() => {
    if (!replaying) return
    const id = setInterval(() => {
      if (streamRef.current?.advance() === true) tick()
    }, REVEAL_TICK_MS)
    return () => {
      clearInterval(id)
    }
  }, [replaying])
  return <div className={css.markdown} data-revealing={replaying || undefined}>{children}</div>
})
