/**
 * The turn-tail chip row: one chip per register slot scoped to the turn —
 * the files the agent changed with their `+n −n` badge, and any note a
 * producer stamped into the same turn. Click-through opens the file on
 * the frozen Changes stop the chip names. The row never writes; counts
 * are `blob` reads of the slot's recorded digests.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { frameDiff } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OpenFileOptions } from '../contract/slots.ts'
import css from './TurnChipRow.module.css'

export type { TurnChipsInjected } from '../contract/slots.ts'
import type { TurnChipsInjected } from '../contract/slots.ts'

/** The row's composed props: the chain-adjacent owner, the inject face, copy. */
export type TurnChipRowProps =
  & PropsRuntime<'conversation.chat.turnChips'>
  & InjectFace<TurnChipsInjected>
  & PropsLocale<'chat'>

/** One chip: the slot it names and its resolved counts. */
interface Chip {
  readonly slotId: string
  readonly path: string
  readonly label: string
  readonly callId?: string
  readonly line?: number
  readonly counts?: { readonly added: number; readonly removed: number }
}

/** The trailing path segment a chip shows. */
export function chipLabel(path: string): string {
  return path.split('/').at(-1) ?? path
}

/** The click destination of one chip: a worktree stop's frozen Changes, a note's line. */
function chipOptions(chip: Chip): OpenFileOptions | undefined {
  if (chip.callId !== undefined) return { display: 'changes', stop: chip.callId }
  if (chip.line !== undefined) return { line: chip.line }
  return undefined
}

/**
 * Render the register chips of one turn; nothing when the turn holds none.
 * @param props - owner, register face, and copy.
 * @returns the chip row, or null for a turn without slots.
 */
export function TurnChipRow({ turn, openFile, slots, blob, t }: TurnChipRowProps): ReactNode {
  const [chips, setChips] = useState<Chip[] | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    setChips(undefined)
    void slots().then((timelines) => {
      if (controller.signal.aborted) return
      const held: Chip[] = []
      for (const timeline of timelines) {
        for (const slot of timeline.slots) {
          if (slot.turn !== turn.turn) continue
          if (slot.kind !== 'worktree' && slot.kind !== 'note') continue
          held.push({
            slotId: slot.slotId,
            path: slot.path,
            label: slot.label,
            ...slot.callId !== undefined ? { callId: slot.callId } : {},
            ...slot.kind === 'note' && slot.line !== undefined ? { line: slot.line } : {},
          })
        }
      }
      setChips(held)
      for (const chip of held) {
        const source = timelines
          .flatMap(timeline => timeline.slots)
          .find(slot => slot.slotId === chip.slotId)
        if (source === undefined || source.kind !== 'worktree' || source.after === undefined) continue
        const afterDigest = source.after
        void Promise.all([
          source.before === undefined ? Promise.resolve<string | null>('') : blob(source.before),
          blob(afterDigest),
        ]).then(([before, after]) => {
          if (controller.signal.aborted || before === null || after === null) return
          setChips(current => (current === undefined ? current : current.map(candidate =>
            candidate.slotId === chip.slotId
              ? { ...candidate, counts: frameDiff(before === '' ? undefined : before, after) }
              : candidate)))
        })
      }
    })
    return () => controller.abort()
  }, [turn, slots, blob])

  if (chips === undefined || chips.length === 0) return null
  return (
    <div className={css.row} role="list" aria-label={t('turnChips.aria')}>
      {chips.map(chip => (
        <button
          key={chip.slotId}
          type="button"
          role="listitem"
          className={css.chip}
          title={`${chip.path} · ${chip.label}`}
          onClick={() => {
            openFile(chip.path, chipOptions(chip))
          }}
        >
          <code>{chipLabel(chip.path)}</code>
          {chip.counts === undefined
            ? null
            : <span className={css.counts}>{t('turnChips.counts', { added: chip.counts.added, removed: chip.counts.removed })}</span>}
        </button>
      ))}
    </div>
  )
}
