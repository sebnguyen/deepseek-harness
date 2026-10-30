/** Present call status and expandable durable result text. */
import { PceRow } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './PresentRow.module.css'

type PresentRowProps = ToolCallViewProps & PropsLocale<typeof NS>

/** Raw arguments can be partial while a call is streaming. */
function fileNames(raw: string): string {
  let args: unknown
  try { args = JSON.parse(raw) }
  catch { return raw } // Truncated tool JSON remains visible until the call completes.
  if (typeof args !== 'object' || args === null || !('files' in args) || !Array.isArray(args.files)) return raw
  return args.files.flatMap((file: unknown) =>
    typeof file === 'object' && file !== null && 'path' in file && typeof file.path === 'string'
      ? [file.path] : [],
  ).join(', ')
}

/**
 * Render a present call using its recorded arguments and result.
 * @param props - tool call and localized status copy.
 * @returns a pce row with the delivery state, paths, and result disclosure.
 */
export function PresentRow({ block, inspect, t, rowMarks }: PresentRowProps) {
  const settled = 'kind' in block
  const state = !settled ? 'running' : block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok'
  const args = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const output = settled ? block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item)).join('\n') : ''
  const details = output || (settled && block.error ? `${block.error.name}: ${block.error.code}` : '')
  return <div data-tool="present" data-state={state}>
    <PceRow
      kind="present"
      glyph="folder-open"
      title={t('row.title')}
      summary={fileNames(args)}
      state={state}
      stateLabel={t(`row.${state}`)}
      marks={rowMarks !== false}
      body={details === ''
        ? null
        : (
          <>
            <pre className={css.output}>{details}</pre>
            {inspect && <button type="button" className={css.inspect} onClick={inspect}>{t('row.inspect')}</button>}
          </>
        )}
    />
  </div>
}
