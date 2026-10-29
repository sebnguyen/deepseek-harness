/** Centered launch card: a mark, a title, and a one-line pitch. */
import type { CSSProperties, ReactNode } from 'react'
import css from './ChoiceCard.module.css'

/** Props for one card in a centered choice roster. */
export type ChoiceCardProps = {
  /** Stable value for tests and per-choice accent styling. */
  value: string
  /** Mark shown above the copy; decorative, the title names the choice. */
  logo: ReactNode
  /** Choice name. */
  title: ReactNode
  /** One-line pitch. */
  children: ReactNode
  /** Accent the mark takes on hover/focus; grayscale until then. */
  accent?: string
  /** Select this choice. */
  onSelect: () => void
}

/** Render one choice card; hover/focus lifts the grey mark into its accent. */
export function ChoiceCard({ value, logo, title, children, accent, onSelect }: ChoiceCardProps) {
  const style = accent === undefined ? undefined : { '--choice-card-accent': accent } as CSSProperties
  return (
    <button type="button" className={css.option} data-choice={value} style={style} onClick={onSelect}>
      <span className={css.logo} aria-hidden="true">{logo}</span>
      <span className={css.title}>{title}</span>
      <span className={css.body}>{children}</span>
    </button>
  )
}
