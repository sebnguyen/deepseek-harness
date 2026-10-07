import { type KeyboardEvent, type MouseEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from './icons/index.tsx'
import css from './DisclosureRow.module.css'

/** Shared 24px disclosure chrome for compact flow rows. */
export interface DisclosureRowProps {
  icon: ReactNode
  title: string
  open: boolean
  expandable: boolean
  onToggle: () => void
  /** Makes the complete title row the disclosure target. */
  expandOnRowClick?: boolean | undefined
  /** Replaces the collapsed icon with a chevron while the row is hovered. */
  previewChevron?: boolean | undefined
  /** Keeps `collapsedContent` inline while open. */
  keepContentWhenOpen?: boolean | undefined
  /**
   * Keeps `children` mounted while closed, visually hidden, so their text
   * stays in the document for search and screen readers.
   */
  keepChildrenMounted?: boolean | undefined
  collapsedContent?: ReactNode
  children?: ReactNode
  className?: string | undefined
  rowClassName?: string | undefined
  leadingClassName?: string | undefined
  chevronClassName?: string | undefined
  titleClassName?: string | undefined
}

/**
 * Render one disclosure header and its controlled expanded content.
 * @param props - Visual content, controlled state, and interaction policy.
 * @returns the disclosure row.
 */
export function DisclosureRow({
  icon,
  title,
  open,
  expandable,
  onToggle,
  expandOnRowClick = false,
  previewChevron = expandable,
  keepContentWhenOpen = false,
  keepChildrenMounted = false,
  collapsedContent,
  children,
  className,
  rowClassName,
  leadingClassName,
  chevronClassName,
  titleClassName,
}: DisclosureRowProps) {
  const rowExpands = expandable && expandOnRowClick
  const toggleFromLeading = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggle()
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rowExpands || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onToggle()
  }
  const collapsedLeading = previewChevron
    ? (
      <>
        <span className={css.iconIdle}>{icon}</span>
        <IconChevronDownOutline14 className={clsx(chevronClassName, css.chevronHover)} />
      </>
    )
    : icon
  const leading = open
    ? <IconChevronDownOutline14 className={chevronClassName} />
    : collapsedLeading

  return (
    <div className={clsx(css.root, className)} data-open={open || undefined}>
      <div
        className={clsx(css.row, rowClassName)}
        data-disclosure-row
        data-expandable={rowExpands || undefined}
        role={rowExpands ? 'button' : undefined}
        tabIndex={rowExpands ? 0 : undefined}
        aria-expanded={rowExpands ? open : undefined}
        onClick={rowExpands ? onToggle : undefined}
        onKeyDown={rowExpands ? toggleFromKeyboard : undefined}
      >
        {expandable && !rowExpands ? (
          <button
            type="button"
            className={clsx(css.leading, leadingClassName)}
            aria-expanded={open}
            onClick={toggleFromLeading}
          >
            {leading}
          </button>
        ) : (
          <span className={clsx(css.leading, leadingClassName)}>
            {leading}
          </span>
        )}
        <span className={clsx(css.title, titleClassName)}>{title}</span>
        {(keepContentWhenOpen || !open) && collapsedContent}
      </div>
      {open || keepChildrenMounted
        ? (
          <BodyShell open={open}>
            {children}
          </BodyShell>
        )
        : null}
    </div>
  )
}

const FOLD_MS = 170

/**
 * The body stays mounted across toggles; collapse plays the fold-out style
 * before handing the body to `hidden="until-found"`, and expansion releases
 * the style a frame after removing `hidden`, so both directions animate
 * wherever transitions run at all. Test DOMs without `matchMedia` and
 * reduced motion swap instantly. The enumerated value is imperative
 * because React's boolean `hidden` prop would drop it.
 */
function BodyShell({ open, children }: { open: boolean; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [foldOut, setFoldOut] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const animated = typeof window.matchMedia === 'function'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!animated) {
      setFoldOut(false)
      if (open) el.removeAttribute('hidden')
      else el.setAttribute('hidden', 'until-found')
      return undefined
    }
    if (open) {
      el.removeAttribute('hidden')
      setFoldOut(true)
      let inner = 0
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setFoldOut(false))
      })
      return () => {
        cancelAnimationFrame(outer)
        cancelAnimationFrame(inner)
      }
    }
    setFoldOut(true)
    const id = window.setTimeout(() => el.setAttribute('hidden', 'until-found'), FOLD_MS)
    return () => window.clearTimeout(id)
  }, [open])
  return (
    <div ref={ref} className={css.body} data-fold-out={foldOut || undefined} hidden>
      {children}
    </div>
  )
}
