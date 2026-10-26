/**
 * Direct mdast→React markdown renderer. Replaces the react-markdown /
 * remark-rehype pipeline with one switch over parsed nodes so streaming can
 * cache frozen blocks as React elements; the rendered DOM is pinned
 * byte-for-byte by `tests/fixtures/markdown-dom` and must not drift.
 *
 * Untrusted-output policy (unchanged from the replaced pipeline): link and
 * image destinations pass a protocol allowlist, images additionally require
 * absolute HTTP(S), raw HTML renders as literal text (no HTML enters the
 * DOM), and KaTeX runs without trusted commands. Fragment-anchor URLs fail
 * the allowlist, so footnote references and back-references render as plain
 * text rather than in-page links.
 *
 * Merge-extensible node unions fall through the documented default (render
 * nothing) rather than ending in assertNever: grammars registered elsewhere
 * may add node types this renderer has no mapping for.
 */

import { Fragment, createElement, useState } from 'react'
import type { Key, ReactNode } from 'react'
import clsx from 'clsx'
import type * as Md from 'mdast'
import type {} from 'mdast-util-math'
import { normalizeUri } from 'micromark-util-sanitize-uri'
import { CodeBlock } from './CodeBlock.tsx'
import { renderTexToReact } from './katex.tsx'
import { MermaidBlock } from './Mermaid.tsx'
import { LinkIcon, classifyLinkPath } from '../LinkIcon.tsx'
import type { PositionedBlock } from './incremental.ts'
import css from './MarkdownText.module.css'

/** Copy-button labels forwarded to fence CodeBlocks (this package is cordis-free, so copy arrives via props). */
export interface MarkdownCodeLabels {
  /** Copy-button idle label. */
  copyLabel: string
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel: string
}

/** Localized chrome for a Markdown document. */
export interface MarkdownLabels {
  code: MarkdownCodeLabels
  footnotes: string
}

function sanitizeUrl(url: string): string {
  try {
    switch (new URL(url).protocol) {
      case 'http:':
      case 'https:':
      case 'mailto:':
        return url
      default:
        return ''
    }
  } catch {
    // Relative and otherwise unparsable destinations are disallowed alongside
    // disallowed protocols; new URL() has no other failure mode for strings.
    return ''
  }
}

function remoteImageUrl(url: string): string | undefined {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' ? url : undefined
  } catch {
    // Same single failure mode as above: not an absolute URL.
    return undefined
  }
}

/** Protocols a vocabulary-rewritten image destination may carry. */
function vocabularyImageUrl(url: string): string | undefined {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'blob:' || protocol === 'data:'
      ? url
      : undefined
  } catch {
    // A vocabulary result must be an absolute URL; anything else stays a miss.
    return undefined
  }
}

/**
 * The displayable source for one image destination: absolute HTTP(S) as
 * authored, otherwise the context's local-path vocabulary when it vouches for
 * the destination. Either miss leaves the authored fallback (alt text) to the
 * caller.
 * @param url - The authored markdown destination.
 * @param pathImages - Rewriting vocabulary, when the render pass has one.
 * @returns The displayable image URL, or undefined.
 */
function imageSource(url: string, pathImages: MarkdownPathImages | undefined): string | undefined {
  const remote = remoteImageUrl(sanitizeUrl(normalizeUri(url)))
  if (remote !== undefined) return remote
  const rewritten = pathImages?.resolve(url)
  return rewritten === undefined ? undefined : vocabularyImageUrl(rewritten)
}

/** Link/image reference targets collected from a document (first definition per identifier wins, as in CommonMark). */
export interface ReferenceTargets {
  /** Link/image definitions keyed by upper-cased identifier. */
  definitions: Map<string, Md.Definition>
  /** Footnote definitions keyed by upper-cased identifier. */
  footnotes: Map<string, Md.FootnoteDefinition>
}

/**
 * Create an empty {@link ReferenceTargets}.
 * @returns Fresh empty maps.
 */
export function createReferenceTargets(): ReferenceTargets {
  return { definitions: new Map(), footnotes: new Map() }
}

/**
 * Record every definition and footnote definition under `nodes` into
 * `targets`, depth-first, keeping the first definition per identifier.
 * @param nodes - Subtrees to walk (top-level blocks or any nested children).
 * @param targets - Accumulator, typically shared across incremental segments.
 */
export function collectReferenceTargets(
  nodes: readonly Md.RootContent[],
  targets: ReferenceTargets,
): void {
  for (const node of nodes) {
    if (node.type === 'definition') {
      const id = node.identifier.toUpperCase()
      if (!targets.definitions.has(id)) targets.definitions.set(id, node)
    } else if (node.type === 'footnoteDefinition') {
      const id = node.identifier.toUpperCase()
      if (!targets.footnotes.has(id)) targets.footnotes.set(id, node)
    }
    if ('children' in node) collectReferenceTargets(node.children, targets)
  }
}

/**
 * Local-path image vocabulary for image destinations: the owner maps an
 * authored destination that fails the remote-URL allowlist (an absolute local
 * file path, for example) to a displayable URL it can vouch for. Absent
 * wherever no such vocabulary exists, authored local destinations keep their
 * documented fallback (the image's alt text). Rewritten destinations must be
 * absolute; the renderer re-checks their protocol before emitting them.
 */
export interface MarkdownPathImages {
  /**
   * Resolve one authored image destination.
   * @param value - The destination exactly as the markdown author wrote it.
   * @returns A displayable absolute URL, or undefined when the destination
   * names no displayable image — it then stays inert alt text.
   */
  resolve(value: string): string | undefined
}

/**
 * File-mention affordance for inline code: the owner resolves an authored
 * token to the file it names, using its own vocabulary of real files — the
 * renderer never guesses at what looks like a path.
 */
export interface MarkdownFileMentions {
  /**
   * Resolve one inline-code token.
   * @param value - The authored token, exactly as written.
   * @returns The opener with its accessible label and full-path title, or
   * undefined when the token names no known file — it then stays inert code.
   */
  resolve(value: string): { open: () => void; label: string; title: string } | undefined
}

/**
 * One render pass's state: immutable options and targets plus the footnote
 * numbering accumulated in document order while references render.
 */
export interface MarkdownRenderContext {
  /** Streaming arm: fences highlight incrementally as they grow; TeX (including ```math fences) stays literal until the settled pass. */
  readonly streaming: boolean
  /** Localized fence copy-button labels. */
  readonly labels: MarkdownLabels
  /** Inside a blockquote's children: tables there always fill the quote's width. */
  readonly inBlockquote?: boolean
  /** Inline-code file mentions; absent wherever no opener vocabulary exists. */
  readonly fileMentions: MarkdownFileMentions | undefined
  /** Local-path image vocabulary; absent wherever no rewriting owner exists. */
  readonly pathImages: MarkdownPathImages | undefined
  /** Inside an anchor's children: interactive mentions must not nest there. */
  readonly inLink?: boolean
  /** Reference targets visible to this pass. */
  readonly targets: ReferenceTargets
  /** Footnote identifiers in first-reference order; a footnote's number is its 1-based index here. */
  readonly footnoteOrder: string[]
  /** References rendered per identifier; drives the section's back-reference count. */
  readonly footnoteCounts: Map<string, number>
  /**
   * Every delta the reveal replay has swept in and is still animating, in
   * absolute (full-message) source offsets. One run per replay tick, trimmed to
   * a window as wide as the animation, so every span finishes its swell before
   * the next tick drops it.
   */
  readonly tailRuns?: readonly MarkdownTailRun[] | undefined
  /**
   * Streaming only: slice-relative source offset from which received characters
   * have not been revealed yet. They render inside a `data-veil` span, out of
   * layout, until the replay reaches them.
   */
  readonly veil?: number | undefined
}

/** One delta's run of newly arrived source characters, in absolute offsets. */
export interface MarkdownTailRun {
  readonly start: number
  readonly end: number
}

/**
 * Render top-level blocks. Nodes that render nothing (definitions, unmapped
 * types) are dropped rather than kept as null placeholders, matching the
 * replaced pipeline's child lists so separator newlines land identically.
 * @param blocks - Blocks with their stream-stable render keys.
 * @param context - The pass state; footnote numbering mutates in document order.
 * @param veilFrom - Streaming only: full-source offset where the reveal cursor
 * sits. A block reaching past it renders its revealed prefix and hides the
 * rest; the caller renders no block that starts after it.
 * @returns One React node per rendered block.
 */
export function renderBlocks(
  blocks: readonly PositionedBlock[],
  context: MarkdownRenderContext,
  veilFrom?: number | undefined,
): ReactNode[] {
  return blocks
    .map((block) => {
      if (veilFrom !== undefined && veilFrom <= block.key) {
        // Not reached yet: rendered for structure but removed from layout, so the
        // block's DOM never re-keys (or remounts) when the replay arrives.
        const element = renderNode(block.node, block.key, { ...context, tailRuns: undefined, veil: undefined })
        return element === null ? null : veilSpan(block.key, element)
      }
      // Runs and the veil arrive in absolute offsets; node positions are
      // relative to the re-parsed slice, so both rebase onto the block.
      const runs = tailRunsFor(block, context.tailRuns)
      const veil = veilFrom === undefined ? undefined : markOffset(block, veilFrom)
      if (runs === undefined && veil === undefined) return renderNode(block.node, block.key, context)
      return renderNode(block.node, block.key, { ...context, tailRuns: runs, veil })
    })
    .filter(element => element !== null)
}

/**
 * Rebase the live deltas onto the block that owns them. A run that opens inside
 * the block belongs to it and clamps to the block's end, so a run reaching
 * across the boundary is never re-applied to the next block as well.
 * @param block - One block of the pass.
 * @param runs - Every delta still inside the live tail, in absolute offsets.
 * @returns The block-relative runs, or undefined when none open in this block.
 */
function tailRunsFor(block: PositionedBlock, runs: readonly MarkdownTailRun[] | undefined): readonly MarkdownTailRun[] | undefined {
  if (runs === undefined || runs.length === 0) return undefined
  const start = block.node.position?.start.offset
  const end = block.node.position?.end.offset
  if (start === undefined || end === undefined) return undefined
  const base = block.key - start
  const span = end - start
  const clipped = runs
    // A run that begins before the block (its first characters fell inside the
    // blank line or an earlier block) still marks the part that landed here, so
    // clip it rather than dropping it and losing the block's opening characters.
    .filter(run => run.end > block.key && run.start < block.key + span)
    .map(run => ({ start: Math.max(run.start, block.key) - base, end: Math.min(run.end, block.key + span) - base }))
  return clipped.length === 0 ? undefined : clipped
}

/**
 * Translate a full-source streaming offset into the slice-relative offset the
 * block's mdast positions use. A block that reaches past `offset` claims it:
 * when the offset precedes its start (the chunk boundary fell inside the
 * blank line before the block) the whole block is new, when it falls inside
 * the block the suffix from the offset is new, and when the block already
 * ended it stays settled and returns undefined. Tail positions are relative to
 * the incremental parse slice while the block key is its absolute source
 * start, so the slice base is `key - start.offset`.
 * @param block - One block of the pass.
 * @param offset - Full-source boundary offset: the animation window's start or
 * the veil.
 * @returns The block-relative offset, or undefined when the block ended first.
 */
function markOffset(block: PositionedBlock, offset: number): number | undefined {
  const start = block.node.position?.start.offset
  const end = block.node.position?.end.offset
  if (start === undefined || end === undefined) return undefined
  const relative = offset - (block.key - start)
  return relative < end ? Math.max(relative, start) : undefined
}

/**
 * Interleave the newline text nodes the replaced pipeline emitted between
 * block-level children. They are invisible between elements but coalesce
 * into adjacent literal raw-HTML text, where the DOM parity fixtures pin
 * them.
 * @param elements - Rendered block children with empty renders already dropped.
 * @param edges - Also emit the leading and trailing newline (hast's loose wrap).
 * @returns The interleaved children.
 */
export function wrapBlockChildren(elements: readonly ReactNode[], edges: boolean): ReactNode[] {
  const wrapped: ReactNode[] = []
  for (const element of elements) {
    if (edges || wrapped.length > 0) wrapped.push('\n')
    wrapped.push(element)
  }
  if (edges && elements.length > 0) wrapped.push('\n')
  return wrapped
}

/**
 * A block child rendered for a parent that must tell paragraphs apart from
 * other blocks (list items unwrap them when tight; footnote bodies receive
 * their back-references inside the trailing paragraph).
 */
type BlockEntry = { paragraph: ReactNode[] } | { element: ReactNode }

/** Render container children into {@link BlockEntry} values, dropping empty renders. */
function renderBlockEntries(
  blocks: readonly Md.RootContent[],
  context: MarkdownRenderContext,
): BlockEntry[] {
  const entries: BlockEntry[] = []
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'paragraph') {
      entries.push({ paragraph: renderChildren(block.children, context) })
    } else {
      const element = renderNode(block, index, context)
      if (element !== null) entries.push({ element })
    }
  }
  return entries
}

function renderChildren(
  nodes: readonly Md.RootContent[],
  context: MarkdownRenderContext,
): ReactNode[] {
  return nodes.map((node, index) => renderNode(node, index, context))
}

/**
 * Render one mdast node, marking whichever part of it arrived in this chunk.
 * Text and literal raw-HTML nodes split at the mark (no HTML parser enters
 * the pipeline, so raw HTML is text); phrasing constructs that cannot be
 * split without breaking their authored form animate whole. Block containers
 * pass the mark down, and constructs where a span would corrupt the structure
 * (fences) leave it unclaimed.
 */
function renderNode(node: Md.RootContent, key: Key, context: MarkdownRenderContext): ReactNode {
  if (node.type === 'text' || node.type === 'html') return renderText(node, key, context)
  const element = renderNodeBody(node, key, context)
  if (element === null) return null
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  // A construct the replay has not reached cannot be split either way, so hide
  // it whole instead of leaking the part behind the veil.
  if (start !== undefined && context.veil !== undefined && context.veil <= start) {
    return veilSpan(`veil:${String(key)}:${context.veil}`, element)
  }
  if (end === undefined || !isTailWrapped(node)) return element
  const inside = context.tailRuns?.find(run => start !== undefined && run.start >= start && run.start < end)
  if (inside !== undefined) return tailSpan(`run:${inside.start}:${String(key)}`, element)
  return element
}

function renderNodeBody(node: Md.RootContent, key: Key, context: MarkdownRenderContext): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return <p key={key}>{renderChildren(node.children, context)}</p>
    case 'heading':
      return createElement(`h${node.depth}`, { key }, ...renderChildren(node.children, context))
    case 'blockquote':
      return (
        <blockquote key={key}>
          {wrapBlockChildren(
            renderChildren(node.children, { ...context, inBlockquote: true }).filter(child => child !== null),
            true,
          )}
        </blockquote>
      )
    case 'thematicBreak':
      return <hr key={key} />
    case 'break':
      // The replaced pipeline emitted a newline text node after each <br>.
      return <Fragment key={key}><br />{'\n'}</Fragment>
    case 'strong':
      return <strong key={key}>{renderChildren(node.children, tailOpaque(context))}</strong>
    case 'emphasis':
      return <em key={key}>{renderChildren(node.children, tailOpaque(context))}</em>
    case 'delete':
      return <del key={key}>{renderChildren(node.children, tailOpaque(context))}</del>
    case 'inlineCode': {
      // Parity with mdast-util-to-hast: inline code renders line endings as spaces.
      const value = node.value.replace(/\r?\n|\r/g, ' ')
      // An inline-code token that is entirely an absolute HTTP(S) URL keeps
      // its code chrome and gains the same safe external anchor as a link;
      // commands, partial URLs, and other schemes stay inert. The value is
      // authored text, not a parsed destination, so no normalizeUri: port,
      // path, and query render unchanged.
      const href = inlineCodeHttpUrl(value)
      if (href !== undefined) return <code key={key}>{renderSafeLink(href, [value], 'link')}</code>
      // A token the owner's file-mention vocabulary recognizes opens that
      // file; the resolver, not this renderer, decides what names a file.
      // Inside an anchor the token stays inert — a button cannot nest there.
      const mention = context.inLink === true ? undefined : context.fileMentions?.resolve(value)
      if (mention !== undefined) {
        return (
          <code key={key}>
            <button
              type="button"
              className={css.fileMention}
              title={mention.title}
              aria-label={mention.label}
              onClick={mention.open}
            >
              <LinkIcon kind={classifyLinkPath(value)} className={css.linkIcon} />
              {value}
            </button>
          </code>
        )
      }
      return <code key={key}>{value}</code>
    }
    case 'code':
      return renderCode(node, key, context)
    case 'math':
      return <Fragment key={key}>{renderTexToReact(node.value, true)}</Fragment>
    case 'inlineMath':
      return <Fragment key={key}>{renderTexToReact(node.value, false)}</Fragment>
    case 'list':
      return renderList(node, key, context)
    case 'listItem':
      // Reachable only in hand-built trees: the grammar emits items inside lists.
      return renderListItem(node, listItemLoose(node), key, context)
    case 'table':
      return renderTable(node, key, context)
    case 'link': {
      const children = renderChildren(node.children, tailOpaque({ ...context, inLink: true }))
      return renderAnchor(node.url, children, key, !anchorWrapsOnlyImages(node.children))
    }
    case 'linkReference':
      return renderLinkReference(node, key, context)
    case 'image':
      return renderImage(node.url, node.alt ?? '', key, context)
    case 'imageReference':
      return renderImageReference(node, key, context)
    case 'footnoteReference':
      return renderFootnoteReference(node, key, context)
    case 'definition':
    case 'footnoteDefinition':
      // Targets render elsewhere: definitions resolve references in place;
      // footnote bodies render in the trailing section.
      return null
    default:
      // Documented default for the merge-extensible union: node types without
      // a mapping (tableRow/tableCell outside a table, frontmatter, future
      // grammar contributions) render nothing.
      return null
  }
}

/**
 * Phrasing node types the tail mark may wrap whole. Block containers
 * (paragraph, heading, quote, list, table) descend instead so the mark lands on
 * their inline runs; fenced code is deliberately absent because a span there
 * would break the highlighted block's structure.
 */
function isTailWrapped(node: Md.RootContent): boolean {
  switch (node.type) {
    case 'strong':
    case 'emphasis':
    case 'delete':
    case 'link':
    case 'linkReference':
    case 'inlineCode':
    case 'image':
    case 'imageReference':
    case 'footnoteReference':
    case 'break':
    case 'inlineMath':
    case 'math':
      return true
    default:
      return false
  }
}

/**
 * Pass state for an atomic construct's children: the wrapper carries the tail
 * mark, so its pieces must not mark themselves (that would nest the spans and
 * split the construct into separately animated fragments).
 * @param context - The enclosing pass state.
 * @returns The same state with the tail mark cleared.
 */
function tailOpaque(context: MarkdownRenderContext): MarkdownRenderContext {
  return { ...context, tailRuns: undefined, veil: undefined }
}

/**
 * Render a text node as plain text, a marked span for each delta the replay has
 * swept in, and a veil over the characters it has not reached yet. The mdast
 * value can be shorter than its source span (backslash escapes, character
 * references), so every boundary clamps: a transient escape may leave a mark
 * covering more of the value, but no character is ever lost or duplicated.
 * Raw HTML reaches here too: it renders as literal text, so it splits like one
 * instead of re-fading the whole node on every tick.
 * @param node - The text or html node to render.
 * @param key - Stable stream key for the node.
 * @param context - The pass state carrying the deltas and the veil.
 * @returns The value, split into plain, marked, and veiled regions.
 */
function renderText(node: Md.Text | Md.Html, key: Key, context: MarkdownRenderContext): ReactNode {
  const from = node.position?.start.offset
  const to = node.position?.end.offset
  const value = node.value
  if (from === undefined || to === undefined) return value
  const limit = clampIndex(context.veil, from, value.length)
  const runs = context.tailRuns
  if (limit >= value.length && (runs === undefined || runs.length === 0)) return value
  const parts: ReactNode[] = []
  let cursor = 0
  for (const run of runs ?? []) {
    if (run.end <= from || run.start >= to) continue
    const cutFrom = clampIndex(run.start, from, value.length)
    const cutTo = Math.min(clampIndex(run.end, from, value.length), limit)
    // An escape can make the value shorter than its source span; a run that lands
    // entirely past the end marks nothing rather than an empty span.
    if (cutTo <= cutFrom || cutFrom >= value.length) continue
    // Plain segments carry keys too: an unkeyed string between keyed spans
    // shifts their positions and makes React remount them.
    if (cutFrom > cursor) parts.push(<Fragment key={`p:${from + cursor}`}>{value.slice(cursor, cutFrom)}</Fragment>)
    parts.push(tailSpan(`run:${run.start}:${String(key)}`, value.slice(cutFrom, cutTo)))
    cursor = Math.max(cursor, cutTo)
  }
  if (cursor < limit) parts.push(<Fragment key={`p:${from + cursor}`}>{value.slice(cursor, limit)}</Fragment>)
  if (limit < value.length) parts.push(veilSpan(`veil:${from + limit}:${String(key)}`, value.slice(limit)))
  return <Fragment key={key}>{parts}</Fragment>
}

/**
 * Whether the one-shot tail fade may run. Non-browser callers and test DOMs
 * may lack `matchMedia`; the absent API keeps the animation on rather than
 * failing the render.
 * @returns False only for an explicit reduced-motion preference.
 */
function tailMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Wrap one delta. The key carries the run's start offset so every delta mounts
 * a fresh span: a stable key would reuse the node and the rise would not fire
 * for the new characters. Only the live tail is ever marked — a block leaving
 * the tail drops its spans in the same commit that caches it, so a freeze never
 * waits for an animation; the spans it removes simply stop. Under reduced
 * motion the span still renders but carries an inline `animation: none` — the
 * sheet's media query is the browser backstop, and this inline gate is what a
 * DOM test can observe.
 * @param key - Caller-supplied key; unique among the node's siblings.
 * @param children - The newly arrived characters.
 * @returns The marked span.
 */
function tailSpan(key: Key, children: ReactNode): ReactNode {
  return (
    <span key={key} data-tail style={tailMotion() ? undefined : { animation: 'none' }}>
      {children}
    </span>
  )
}

/** Absolute source offset → index into a node whose value starts at `from`. */
function clampIndex(offset: number | undefined, from: number, length: number): number {
  if (offset === undefined) return length
  return Math.min(Math.max(offset - from, 0), length)
}

/**
 * Hide characters that have been received but not revealed yet. The replay
 * drops the veil as it passes, so the block grows instead of popping in.
 * @param key - Caller-supplied key; unique among the node's siblings.
 * @param children - The characters still waiting their turn.
 */
function veilSpan(key: Key, children: ReactNode): ReactNode {
  return (
    <span key={key} data-veil>
      {children}
    </span>
  )
}

function renderCode(node: Md.Code, key: Key, context: MarkdownRenderContext): ReactNode {
  const language = node.lang ?? undefined
  if (node.value === '') {
    // Parity: the replaced pipeline kept the stock <pre> for an empty fence.
    return (
      <pre key={key}>
        <code className={language === undefined ? undefined : `language-${language}`} />
      </pre>
    )
  }
  // The replaced pipeline recovered the grammar id from the hast class with
  // /language-([\w-]+)/, which truncates at the first non-word character.
  const lang = language === undefined ? undefined : /^[\w-]+/.exec(language)?.[0]
  if (!context.streaming && lang === 'math') {
    // ```math fences render as display TeX once settled (rehype-katex parity);
    // its text extraction saw the code block's trailing newline.
    return <Fragment key={key}>{renderTexToReact(`${node.value}\n`, true)}</Fragment>
  }
  if (!context.streaming && lang === 'mermaid') {
    // ```mermaid fences render as an SVG diagram once settled; MermaidBlock
    // falls back to the ordinary CodeBlock itself while rendering or on a
    // parse error, so no separate streaming/error arm is needed here.
    return (
      <MermaidBlock
        key={key}
        code={node.value}
        copyLabel={context.labels.code.copyLabel}
        copiedLabel={context.labels.code.copiedLabel}
      />
    )
  }
  return (
    <CodeBlock
      key={key}
      // The replaced hast pipeline appended one synthetic newline that
      // CodeBlock's display trim removes; feeding the bare value would make
      // that trim eat a REAL trailing blank line inside the fence instead.
      code={`${node.value}\n`}
      lang={lang}
      // Streaming keys are source offsets, stable while the fence grows, so
      // the CodeBlock instance (and its incremental highlight session)
      // survives every chunk. A fence whose info string is still mid-chunk
      // has no content yet and took the empty-fence arm above, so `lang`
      // here is final: it can never re-resolve to a different grammar.
      streaming={context.streaming}
      copyLabel={context.labels.code.copyLabel}
      copiedLabel={context.labels.code.copiedLabel}
    />
  )
}

/** A list is loose when it or any of its items is spread; every item then keeps its paragraphs. */
function listLoose(list: Md.List): boolean {
  return (list.spread ?? false) || list.children.some(listItemLoose)
}

function listItemLoose(item: Md.ListItem): boolean {
  return item.spread ?? item.children.length > 1
}

function renderList(node: Md.List, key: Key, context: MarkdownRenderContext): ReactNode {
  const loose = listLoose(node)
  const properties: { start?: number; className?: string } = {}
  if (typeof node.start === 'number' && node.start !== 1) properties.start = node.start
  if (node.children.some(item => typeof item.checked === 'boolean')) {
    properties.className = 'contains-task-list'
  }
  return createElement(
    node.ordered === true ? 'ol' : 'ul',
    { key, ...properties },
    ...node.children.map((item, index) => renderListItem(item, loose, index, context)),
  )
}

function renderListItem(
  item: Md.ListItem,
  loose: boolean,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  const entries = renderBlockEntries(item.children, context)
  const task = typeof item.checked === 'boolean'
  if (task) {
    const checkbox = <input key="task-checkbox" type="checkbox" checked={item.checked === true} disabled />
    const head = entries[0]
    if (head !== undefined && 'paragraph' in head) {
      head.paragraph = head.paragraph.length > 0 ? [checkbox, ' ', ...head.paragraph] : [checkbox]
    } else {
      entries.unshift({ paragraph: [checkbox] })
    }
  }
  // Newline placement and tight-paragraph unwrapping mirror
  // mdast-util-to-hast's list-item handler: a newline before every child
  // except a tight leading paragraph, and after a trailing non-paragraph
  // (or any trailing child when loose).
  const parts: ReactNode[] = []
  for (const [index, entry] of entries.entries()) {
    const isParagraph = 'paragraph' in entry
    if (loose || index !== 0 || !isParagraph) parts.push('\n')
    if (!isParagraph) parts.push(entry.element)
    else if (loose) parts.push(<p key={`p-${index}`}>{entry.paragraph}</p>)
    else parts.push(<Fragment key={`p-${index}`}>{entry.paragraph}</Fragment>)
  }
  const tail = entries[entries.length - 1]
  if (tail !== undefined && (loose || !('paragraph' in tail))) parts.push('\n')
  return (
    <li key={key} className={task ? 'task-list-item' : undefined}>
      {parts}
    </li>
  )
}

function renderTable(node: Md.Table, key: Key, context: MarkdownRenderContext): ReactNode {
  const align = node.align ?? null
  const [headRow, ...bodyRows] = node.children
  const columns = align === null ? headRow?.children.length ?? 0 : align.length
  // Four or more columns read as a comparison matrix: the block keeps the
  // table at natural width and exposes the stable `md-table-wide` hook so a
  // hosting layout (the chat transcript) can widen it past the message
  // column. Narrower tables — and any table inside a blockquote — fill the
  // column and wrap instead (deepsuite chat TableWrapper parity).
  const wide = columns >= 4 && context.inBlockquote !== true
  return (
    // Wide tables rest with overflow-x hidden (the hover-revealed bar in
    // MarkdownText.module.css), which drops Chromium's implicit scroller
    // focusability — the explicit tabindex keeps them keyboard-reachable,
    // and :focus-visible restores scrolling.
    <div
      key={key}
      className={clsx(css.tableScroll, wide ? 'md-table-wide' : css.tableFill)}
      tabIndex={wide ? 0 : undefined}
    >
      <table>
        {headRow !== undefined && <thead>{renderTableRow(headRow, 'th', align, 0, context)}</thead>}
        {bodyRows.length > 0 && (
          <tbody>
            {bodyRows.map((row, index) => renderTableRow(row, 'td', align, index + 1, context))}
          </tbody>
        )}
      </table>
    </div>
  )
}

function renderTableRow(
  row: Md.TableRow,
  cellTag: 'th' | 'td',
  align: readonly Md.AlignType[] | null,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  // With column alignment present, every row renders exactly one cell per
  // column, padding or truncating the row (mdast-util-to-hast parity).
  const length = align === null ? row.children.length : align.length
  const cells: ReactNode[] = []
  for (let index = 0; index < length; index++) {
    const cell = row.children[index]
    const alignValue = align?.[index]
    cells.push(createElement(
      cellTag,
      // hast-util-to-jsx-runtime's default tableCellAlignToStyle turned the
      // deprecated align attribute into an inline style; keep that DOM.
      { key: index, style: alignValue == null ? undefined : { textAlign: alignValue } },
      ...(cell === undefined ? [] : renderChildren(cell.children, context)),
    ))
  }
  return <tr key={key}>{cells}</tr>
}

/**
 * True when an anchor's markdown children are all images, so the anchor is a
 * clickable picture (badge, thumbnail): the leading URL glyph would dangle
 * beside the image instead of leading link text, so those anchors skip it.
 */
function anchorWrapsOnlyImages(children: Md.PhrasingContent[]): boolean {
  return children.length > 0 && children.every(child => child.type === 'image' || child.type === 'imageReference')
}

/** Anchor over an already-authored href: allowlisted or unwrapped, external links get the safe attributes. */
function renderSafeLink(href: string, children: ReactNode[], key: Key, glyph = true): ReactNode {
  const safeHref = sanitizeUrl(href)
  if (safeHref === '') return <Fragment key={key}>{children}</Fragment>
  const external = ['http:', 'https:'].includes(new URL(safeHref).protocol)
  return (
    <a
      key={key}
      href={safeHref}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {glyph && <LinkIcon kind="url" className={css.linkIcon} />}
      {children}
    </a>
  )
}

/** Anchor over a parsed markdown destination, which hast normalized before the allowlist saw it. */
function renderAnchor(url: string, children: ReactNode[], key: Key, glyph = true): ReactNode {
  return renderSafeLink(normalizeUri(url), children, key, glyph)
}

/**
 * The complete inline-code value when it is exactly an absolute HTTP(S) URL
 * (no surrounding whitespace); anything else stays inert code.
 */
function inlineCodeHttpUrl(value: string): string | undefined {
  if (value.trim() !== value) return undefined
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:' ? value : undefined
  } catch {
    // Not an absolute URL at all — the only way new URL() rejects a string.
    return undefined
  }
}

function renderImage(url: string, alt: string, key: Key, context: MarkdownRenderContext): ReactNode {
  const imageSrc = imageSource(url, context.pathImages)
  if (imageSrc === undefined) {
    return <span key={key} className={css.imageAlt}>{alt}</span>
  }
  return <MarkdownImage key={`${key}:${imageSrc}`} src={imageSrc} alt={alt} destination={url} />
}

/** Failed loads retain the authored alt or destination; a new source remounts the image. */
function MarkdownImage({ src, alt, destination }: { src: string; alt: string; destination: string }): ReactNode {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className={css.imageAlt}>{alt || destination}</span>
  return (
    <img
      className={css.image}
      src={src}
      alt={alt}
      onError={() => { setFailed(true) }}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  )
}

/** The bracketed source text a reference reverts to when its definition is missing. */
function referenceSuffix(node: Md.LinkReference | Md.ImageReference): string {
  if (node.referenceType === 'collapsed') return '][]'
  if (node.referenceType === 'full') return `][${node.label ?? node.identifier}]`
  return ']'
}

function renderLinkReference(
  node: Md.LinkReference,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  const definition = context.targets.definitions.get(node.identifier.toUpperCase())
  if (definition === undefined) {
    // The grammar only emits references whose definitions exist somewhere in
    // the same parse, but incremental segments and hand-built trees may still
    // present unresolved ones: revert to the bracketed source text — which is
    // not an anchor, so mentions inside it stay live.
    return <Fragment key={key}>{'['}{renderChildren(node.children, tailOpaque(context))}{referenceSuffix(node)}</Fragment>
  }
  const rendered = renderChildren(node.children, tailOpaque({ ...context, inLink: true }))
  return renderAnchor(definition.url, rendered, key, !anchorWrapsOnlyImages(node.children))
}

function renderImageReference(
  node: Md.ImageReference,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  const definition = context.targets.definitions.get(node.identifier.toUpperCase())
  if (definition === undefined) return `![${node.alt ?? ''}${referenceSuffix(node)}`
  return renderImage(definition.url, node.alt ?? '', key, context)
}

function renderFootnoteReference(
  node: Md.FootnoteReference,
  key: Key,
  context: MarkdownRenderContext,
): ReactNode {
  const id = node.identifier.toUpperCase()
  const seen = context.footnoteCounts.get(id)
  if (seen === undefined) context.footnoteOrder.push(id)
  context.footnoteCounts.set(id, (seen ?? 0) + 1)
  // The in-page anchor fails the protocol allowlist, so only the numbered
  // superscript renders (matching the replaced pipeline's unwrapped link).
  return <sup key={key}>{String(context.footnoteOrder.indexOf(id) + 1)}</sup>
}

/**
 * Render the trailing footnote section for every footnote referenced during
 * the pass, in first-reference order, with one plain-text back-reference
 * marker per rendered reference.
 * @param context - The pass state after all blocks rendered.
 * @returns The section, or null when no referenced footnote has a definition.
 */
export function renderFootnoteSection(context: MarkdownRenderContext): ReactNode | null {
  const items: ReactNode[] = []
  for (const id of context.footnoteOrder) {
    const definition = context.targets.footnotes.get(id)
    if (definition === undefined) continue
    const count = context.footnoteCounts.get(id) ?? 0
    const backrefs: ReactNode[] = []
    for (let reference = 1; reference <= count; reference++) {
      if (backrefs.length > 0) backrefs.push(' ')
      backrefs.push('↩')
      if (reference > 1) backrefs.push(<sup key={`re-${reference}`}>{String(reference)}</sup>)
    }
    const entries = renderBlockEntries(definition.children, context)
    const tail = entries[entries.length - 1]
    const body: ReactNode[] = entries.map((entry, index) => (
      'paragraph' in entry
        ? (
          <p key={`p-${index}`}>
            {entry.paragraph}
            {entry === tail && <>{' '}{backrefs}</>}
          </p>
        )
        : entry.element
    ))
    // Without a trailing paragraph the back-references join the block list
    // itself (and pick up the wrap newlines), as in the replaced pipeline.
    if (tail === undefined || !('paragraph' in tail)) body.push(...backrefs)
    items.push(
      <li key={id} id={`user-content-fn-${normalizeUri(id.toLowerCase())}`}>
        {wrapBlockChildren(body, true)}
      </li>,
    )
  }
  if (items.length === 0) return null
  return (
    <section key="footnotes" data-footnotes className="footnotes">
      <h2 id="footnote-label" className="sr-only">{context.labels.footnotes}</h2>
      <ol>{items}</ol>
    </section>
  )
}
