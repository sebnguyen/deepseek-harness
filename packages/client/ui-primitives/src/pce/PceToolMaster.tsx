/**
 * The gallery's ToolMasterDetail: a compact STATE / column / DETAIL table for
 * multi-row tool results, with the selected row's preview stacked under the
 * table so both get the column's full width. Rows own their preview body so
 * each tool kind keeps its block.
 */
import { useState, type ReactNode } from 'react'
import { StateDot } from '../StateDot.tsx'
import { PixelGlyph } from '../PixelGlyph.tsx'
import type { PceState } from './PceRow.tsx'

/** One selectable result row. */
export interface PceToolRow {
  /** Row outcome; drives the table dot. */
  tone: PceState
  /** Localized state word (Done / Failed / Running). */
  state: string
  /** Primary cell: file path or command. */
  primary: string
  /** Right-aligned detail cell (window, duration, stat). */
  detail?: string | undefined
  /** Body rendered in the preview pane when this row is selected. */
  body: ReactNode
}

/** Props for {@link PceToolMaster}. */
export interface PceToolMasterProps {
  rows: readonly PceToolRow[]
  /** Middle column label (`FILE` / `COMMAND`). */
  column: string
  /** Preview kind label (`Read` / `Diff` / `Terminal`). */
  previewKind: string
  /** Localized close-preview accessible label. */
  closeLabel: string
  /** Localized row-select accessible label; `{name}` is the primary cell. */
  previewLabel: string
}

function dotState(tone: PceState): 'done' | 'warning' | 'error' | 'ongoing' {
  switch (tone) {
    case 'running': return 'ongoing'
    case 'error': return 'error'
    case 'stopped': return 'warning'
    default: return 'done'
  }
}

/**
 * Render the table plus its optional preview.
 * @param props - rows, column/kind labels, and localized select/close copy.
 * @returns the master/detail surface.
 */
export function PceToolMaster({ rows, column, previewKind, closeLabel, previewLabel }: PceToolMasterProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const row = selected === null ? null : rows[selected] ?? null
  return (
    <div className={`pce-tool-master${row === null ? '' : ' is-preview-open'}`}>
      <div className="pce-table pce-array pce-tool-table">
        <div className="pce-tr pce-thead">
          <span>STATE</span>
          <span>{column}</span>
          <span>DETAIL</span>
        </div>
        {rows.map((entry, index) => {
          const active = selected === index
          return (
            <div className={`pce-tr${active ? ' is-selected' : ''}`} key={`${entry.primary}-${index}`}>
              <button
                type="button"
                className="pce-row-hit"
                aria-label={previewLabel.replace('{name}', entry.primary)}
                aria-expanded={active}
                onClick={() => { setSelected(current => current === index ? null : index) }}
              />
              <span className="pce-cell-state">
                <StateDot state={dotState(entry.tone)} />
                {entry.state}
              </span>
              <span className="pce-cell-primary">{entry.primary}</span>
              <span className="pce-cell-detail">{entry.detail ?? ''}</span>
            </div>
          )
        })}
      </div>
      <div className="pce-tool-preview" aria-hidden={row === null ? true : undefined}>
        {row === null ? null : (
          <div className="pce-tool-preview-inner">
            <div className="pce-tool-preview-head">
              <span className="pce-tool-preview-kind">{previewKind}</span>
              <strong>{row.primary}</strong>
              <span className="pce-tool-preview-state">
                <StateDot state={dotState(row.tone)} />
                {row.state}
              </span>
              <button
                type="button"
                className="pce-tool-preview-close"
                aria-label={closeLabel}
                onClick={() => { setSelected(null) }}
              >
                <PixelGlyph name="close" size={16} />
              </button>
            </div>
            <div className="pce-tool-preview-body">{row.body}</div>
          </div>
        )}
      </div>
    </div>
  )
}
