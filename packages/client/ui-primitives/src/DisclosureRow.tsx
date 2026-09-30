import { type KeyboardEvent, type MouseEvent, type ReactNode, useLayoutEffect, useRef } from 'react'
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
      {open
        ? children
        : keepChildrenMounted
          ? (
            <UntilFoundShell>
              {children}
            </UntilFoundShell>
          )
          : null}
    </div>
  )
}

/**
 * `hidden="until-found"` is an enumerated attribute; React's boolean `hidden`
 * prop would drop the value, so the shell writes it on the element itself.
 */
function UntilFoundShell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    ref.current?.setAttribute('hidden', 'until-found')
  }, [])
  return (
    <div ref={ref} hidden>
      {children}
    </div>
  )
}
