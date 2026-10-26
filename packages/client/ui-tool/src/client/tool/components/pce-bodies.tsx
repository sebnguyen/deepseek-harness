/** Token-block bodies for the non-terminal pce tool rows. */
import { unifiedLines, type DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AskQuestionCardModel } from '../models/ask-question-card-model.ts'
import type { SearchCardModel } from '../models/search-card-model.ts'
import type { WebCardModelProps } from '../models/web-card-model.ts'

/** One parsed todo item the row paints in `.pce-todos`. */
export interface PceTodoItem {
  content: string
  status: string
}

/** Open one authored path from a body banner. */
type OpenPath = ((path: string) => void) | undefined

/** Hostname fallback for a source with no title. */
function hostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * One pce code block per diff hunk, with add/remove tints and dual gutters.
 * @param props.diffs - validated hunks in element order.
 * @param props.onOpenPath - optional explorer/host open for the hunk path.
 * @returns the stacked diff blocks.
 */
export function PceDiffBody({ diffs, onOpenPath, copyLabel = 'Copy' }: {
  diffs: readonly DiffHunk[]
  onOpenPath?: OpenPath
  copyLabel?: string
}) {
  return (
    <>
      {diffs.map((hunk, index) => {
        const lines = unifiedLines(hunk.oldText ?? undefined, hunk.newText)
        const added = lines.filter(line => line.kind === 'added').length
        const removed = lines.filter(line => line.kind === 'removed').length
        return (
          <div className="pce-code pce-diff" key={`${hunk.path}-${index}`} data-diff>
            <div className="pce-code-head">
              {onOpenPath === undefined
                ? <span className="pce-code-label">{hunk.path}</span>
                : (
                  <button type="button" className="pce-code-label" onClick={() => onOpenPath(hunk.path)}>
                    {hunk.path}
                  </button>
                )}
              <span className="pce-code-meta">{`+${added} -${removed}`}</span>
              <button
                type="button"
                className="pce-action"
                onClick={() => {
                  const text = lines.map(line => line.text).join('\n')
                  void navigator.clipboard?.writeText(text)
                }}
              >
                {copyLabel}
              </button>
            </div>
            <div className="pce-code-body">
              {lines.map((line, lineIndex) => (
                <div
                  key={lineIndex}
                  className={`pce-line${line.kind === 'added' ? ' is-add' : line.kind === 'removed' ? ' is-remove' : ''}`}
                >
                  <span className="pce-gutter">{line.newLine ?? line.oldLine ?? ''}</span>
                  <span className="pce-line-text">{line.text === '' ? ' ' : line.text}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}

/**
 * Search matches or paths as pce code lines.
 * @param props.search - derived search card + recovery locator.
 * @returns the result block.
 */
export function PceSearchBody({ search, copyLabel }: { search: SearchCardModel; copyLabel?: string }) {
  const { card } = search
  return (
    <div className="pce-code" data-search={card.kind}>
      <div className="pce-code-head">
        <span>{card.kind === 'matches' ? `${card.files.length} files` : `${card.paths.length} paths`}</span>
        <span className="pce-code-meta">{card.total} total{card.truncated ? ' · capped' : ''}</span>
        {copyLabel === undefined ? null : (
          <button
            type="button"
            className="pce-action"
            onClick={() => {
              const text = card.kind === 'matches'
                ? card.files.flatMap(file => [file.path, ...file.matches.map(match => `${match.lineNumber}: ${match.line}`)]).join('\n')
                : card.paths.join('\n')
              void navigator.clipboard?.writeText(text)
            }}
          >
            {copyLabel}
          </button>
        )}
      </div>
      <div className="pce-code-body">
        {card.kind === 'matches'
          ? card.files.flatMap((file, fileIndex) => [
            <div className="pce-line" key={`file-${fileIndex}`}>
              <span className="pce-line-text">{file.path}</span>
            </div>,
            ...file.matches.map((match, matchIndex) => (
              <div className="pce-line" key={`match-${fileIndex}-${matchIndex}`}>
                <span className="pce-gutter">{match.lineNumber}</span>
                <span className="pce-line-text">{match.line === '' ? ' ' : match.line}</span>
              </div>
            )),
          ])
          : card.paths.map((path, index) => (
            <div className="pce-line" key={`${path}-${index}`}>
              <span className="pce-line-text">{path}</span>
            </div>
          ))}
      </div>
    </div>
  )
}

/**
 * Web answer/sources or fetch status as pce lines.
 * @param props.web - derived web card.
 * @returns the result block.
 */
export function PceWebBody({ web }: { web: WebCardModelProps }) {
  if (web.kind === 'fetch') {
    return (
      <div className="pce-code" data-web="fetch">
        <div className="pce-code-head">
          <a href={web.url}>{web.url}</a>
          <span className="pce-code-meta">HTTP {web.statusCode}</span>
        </div>
      </div>
    )
  }
  return (
    <div className="pce-code" data-web={web.kind}>
      <div className="pce-code-head">
        <span>{web.sources.length} sources</span>
        {web.truncated ? <span className="pce-code-meta">capped</span> : null}
      </div>
      <div className="pce-code-body">
        {web.answer === undefined ? null : (
          <div className="pce-line"><span className="pce-line-text">{web.answer}</span></div>
        )}
        {web.sources.flatMap((source, index) => [
          <div className="pce-line" key={`${source.url}-${index}`}>
            <span className="pce-gutter">{index + 1}</span>
            <span className="pce-line-text">{source.title ?? hostname(source.url)}</span>
          </div>,
          ...source.snippet === undefined || source.snippet === ''
            ? []
            : [
              <div className="pce-line" key={`${source.url}-${index}-snippet`}>
                <span className="pce-line-text">{source.snippet}</span>
              </div>,
            ],
        ])}
      </div>
    </div>
  )
}

/**
 * Plan items with done/active/pending markers.
 * @param props.todos - parsed plan items.
 * @returns the todo list.
 */
export function PceTodosBody({ todos }: { todos: readonly PceTodoItem[] }) {
  return (
    <div className="pce-todos">
      {todos.map((todo, index) => {
        const tone = todo.status === 'completed'
          ? 'is-done'
          : todo.status === 'in_progress' ? 'is-active' : undefined
        const mark = todo.status === 'completed'
          ? <span aria-hidden>✓</span>
          : <span aria-hidden>{todo.status === 'in_progress' ? '●' : '○'}</span>
        return (
          <span key={index} className={tone}>
            {mark}{` ${todo.content}`}
          </span>
        )
      })}
    </div>
  )
}

/**
 * Question/answer transcript with selected options.
 * @param props.card - validated ask transcript.
 * @returns the ask body.
 */
export function PceAskBody({ card }: { card: AskQuestionCardModel }) {
  return (
    <div className="pce-ask">
      {card.kind === 'answered'
        ? card.questions.map(question => (
          <div key={question.id}>
            <p>{question.question}</p>
            <div className="pce-options">
              {'answers' in question && question.answers.map((answer, index) => (
                <span key={index} className={index === 0 ? 'is-picked' : undefined}>{answer}</span>
              ))}
            </div>
          </div>
        ))
        : card.questions.map(question => (
          <div key={question.id}>
            <p>{question.question}</p>
          </div>
        ))}
      <span className="pce-meta">
        {card.kind === 'answered' ? card.skippedLabel : card.verdict}
      </span>
    </div>
  )
}
