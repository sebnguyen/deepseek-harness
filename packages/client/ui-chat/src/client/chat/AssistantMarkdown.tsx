import { Fragment, memo, useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { JsonBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions, MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { AssistantBlock } from '../contract/snapshot.ts'
import { markdownLabels } from '../markdown-labels.ts'
import { ReasoningRow } from './ReasoningRow.tsx'
import css from './AssistantMarkdown.module.css'

/**
 * Map one authored media destination to the same-origin workspace-file URL.
 * @param protocol - `window.location.protocol` at render time.
 * @param origin - `window.location.origin` at render time.
 * @param value - The authored markdown destination, exactly as written.
 * @returns The API URL for an absolute POSIX path on an HTTP(S) page, or
 * undefined when the destination cannot be a Host-served local file
 * (non-HTTP transport such as Electron `file://`, protocol-relative or
 * relative destinations).
 */
export function localPathMediaUrl(protocol: string, origin: string, value: string): string | undefined {
  if (protocol !== 'http:' && protocol !== 'https:') return undefined
  if (value.length === 0 || !value.startsWith('/') || value.startsWith('//')) return undefined
  return `${origin}/api/file?path=${encodeURIComponent(value)}`
}

export interface AssistantMarkdownProps {
  blocks: readonly AssistantBlock[]
  streaming: boolean
  /** Frozen partial of an aborted turn: rendered with a stopped marker. */
  interrupted?: boolean | undefined
  /** Render consecutive image blocks through the attachment slot. */
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Resolved prose file mentions for this Assistant's closing turn. */
  mentions?: MarkdownFileMentions | undefined
  /** Add the 6px transcript inset: the answer row, not the Think row. */
  inset?: boolean | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/** Reasoning block as the Think variant summary row (figma 39:28304). */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  blocks, streaming, interrupted, renderMessageImages, mentions, t, inset = false,
}: AssistantMarkdownProps) {
  // Stable per locale revision (t identity changes on switch): a fresh object
  // per render would rebuild MarkdownText's component table every chunk.
  const labels = useMemo(() => markdownLabels(t), [t])
  // Local media paths in the closing prose rewrite to the same-origin file
  // API (policy re-validation lives host-side). The vocabulary identity is
  // stable per page load because MarkdownText memoizes on it.
  const pathImages = useMemo<MarkdownPathImages>(() => {
    const { protocol, origin } = window.location
    return { resolve: value => localPathMediaUrl(protocol, origin, value) }
  }, [])
  // Granularity: fade the characters that arrived since the previous commit,
  // not the block that holds them. Track the trailing prose block's committed
  // length — a block change (index or kind) and the end of streaming both
  // restart the measurement, so a fresh block fades whole and no stale length
  // marks a later block.
  const tailRef = useRef<{ index: number; kind: 'text' | 'reasoning'; length: number } | null>(null)
  const last = blocks.length - 1
  const trailing = blocks[last]
  const trailingText = trailing !== undefined && (trailing.kind === 'text' || trailing.kind === 'reasoning')
    ? { kind: trailing.kind, length: trailing.text.length }
    : undefined
  const trailingKind = trailingText?.kind
  const trailingLength = trailingText?.length
  const previousTail = tailRef.current
  const tailFrom = streaming && trailingKind === 'text'
    ? previousTail !== null && previousTail.index === last && previousTail.kind === 'text'
      ? previousTail.length
      : 0
    : undefined
  useEffect(() => {
    tailRef.current = streaming && trailingKind !== undefined && trailingLength !== undefined
      ? { index: last, kind: trailingKind, length: trailingLength }
      : null
  }, [streaming, last, trailingKind, trailingLength])
  // Tool-call heads render as tool rows in the chat view's grouping pass, so
  // a node that is only those heads (or empty) would paint an empty root
  // between tool groups — skip the shell unless something visible remains.
  const hasVisible = streaming
    || interrupted === true
    || blocks.some(block => block.kind !== 'tool-call')
  if (!hasVisible) return null
  const rendered: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block === undefined) continue
    switch (block.kind) {
      case 'text':
        rendered.push(
          <MarkdownText
            key={i}
            text={block.text}
            streaming={streaming}
            tailFrom={i === last ? tailFrom : undefined}
            labels={labels}
            fileMentions={mentions}
            pathImages={pathImages}
          />,
        )
        break
      case 'reasoning':
        rendered.push(
          <ReasoningRow key={i} text={block.text} running={streaming && i === last} t={t} />,
        )
        break
      case 'image': {
        // Consecutive image blocks share one gallery so several images tile
        // into rows instead of each opening a one-image group of its own.
        // Keyed by the group's FIRST block index: a streaming append that
        // extends the group then only grows `images` instead of remounting
        // the gallery under a shifted key.
        const start = i
        const group = [block]
        while (i + 1 < blocks.length) {
          const next = blocks[i + 1]
          if (next === undefined || next.kind !== 'image') break
          group.push(next)
          i += 1
        }
        rendered.push(
          <Fragment key={start}>
            {renderMessageImages({
              images: group.map(({ attachment }) => ({ attachment })),
              align: 'start',
            })}
          </Fragment>,
        )
        break
      }
      // Grouped into tool rows by ChatView; hasVisible above skips an empty shell.
      case 'tool-call':
        break
      default:
        rendered.push(
          <JsonBlock
            key={i}
            label={t('message.unknownBlock')}
            payload={block.block}
            truncatedLabel={total => t('json.truncated', { total })}
          />,
        )
    }
  }
  return (
    <div className={css.root} data-streaming={streaming || undefined}>
      <div className={css.body} data-inset={inset ? '' : undefined}>
        {rendered}
        {interrupted && <span className={css.stopped}>{t('message.stopped')}</span>}
      </div>
    </div>
  )
})
