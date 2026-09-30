/**
 * The sed-style program engine: pure string transforms over one stream.
 * Compiles structured entries into validated operations (literal replace,
 * JavaScript-regex replace, inclusive line-range replace/delete, and
 * insert-after-line), then folds them sequentially over a text so later entries
 * address earlier results. Throws before any commit on a failing entry, which is
 * what makes a batch all-or-nothing; never performs I/O.
 * @module @deepseek-ai/dsh-tool-fs/src/program
 */

import { FsError } from '@deepseek-ai/dsh-fs'

/** Raw schema shape of one `edits` array element. */
export interface RawProgramEntry {
  /** Literal form: the exact text to find. */
  old_string?: string
  /** Regex form: a JavaScript regular-expression source. */
  pattern?: string
  /** Replacement text for every form; omitted or empty deletes. */
  new_string?: string
  /** Literal/regex forms: replace every match instead of requiring one. */
  replace_all?: boolean
  /** Line-range form: first line, 1-based inclusive. */
  first_line?: number
  /** Line-range form: last line, 1-based inclusive. */
  last_line?: number
  /** Insert form: insert after this 1-based line; 0 for the top. */
  after_line?: number
}

/** One validated, compile-ready program entry. */
export type CompiledEntry =
  | { kind: 'literal'; oldString: string; newString: string; replaceAll: boolean }
  | { kind: 'regex'; re: RegExp; newString: string; replaceAll: boolean }
  | { kind: 'lines'; firstLine: number; lastLine: number; newString: string }
  | { kind: 'insert'; afterLine: number; newString: string }

/** A complete program: its execution mode and its compiled entries. */
export interface WriteProgram {
  /** `content` when a whole-file stream is present, else in-place `program`. */
  mode: 'content' | 'program'
  /** The compiled operations, empty for content-only calls. */
  entries: CompiledEntry[]
}

/** Per-entry match accounting for the model-facing result. */
export interface EntryOutcome {
  /** The entry's index in the program. */
  index: number
  /** Which form ran. */
  kind: CompiledEntry['kind']
  /** Matches found (inserts report the lines they added). */
  matches: number
}

/**
 * Validate and compile raw entries into a program. Entry forms are distinguished
 * by which fields are present; mixed or missing forms throw with the entry
 * index. The complete program's mode follows from the content stream.
 * @param args - the raw tool content stream and `edits` array.
 * @returns the compiled program.
 */
export function compileProgram(args: { content?: string | undefined; edits?: RawProgramEntry[] | undefined }): WriteProgram {
  const entries = (args.edits ?? []).map(compileEntry)
  return { mode: args.content === undefined ? 'program' : 'content', entries }
}

function compileEntry(raw: RawProgramEntry, index: number): CompiledEntry {
  const forms = [
    raw.old_string !== undefined,
    raw.pattern !== undefined,
    raw.first_line !== undefined || raw.last_line !== undefined,
    raw.after_line !== undefined,
  ]
  if (forms.filter(Boolean).length !== 1) {
    throw new Error(`edits[${index}]: use exactly one form — old_string, pattern, first_line/last_line, or after_line`)
  }
  const newString = raw.new_string ?? ''
  const replaceAll = raw.replace_all === true
  if (raw.old_string !== undefined) {
    const oldString = raw.old_string
    if (oldString.length === 0) throw new Error(`edits[${index}]: old_string must be a non-empty string`)
    if (oldString === newString) throw new Error(`edits[${index}]: old_string and new_string must differ`)
    return { kind: 'literal', oldString, newString, replaceAll }
  }
  if (raw.pattern !== undefined) {
    let re: RegExp
    try {
      re = new RegExp(raw.pattern)
    } catch (cause) {
      throw new Error(`edits[${index}]: invalid regular expression`, { cause })
    }
    if (re.source.length === 0) throw new Error(`edits[${index}]: pattern must be non-empty`)
    return { kind: 'regex', re, newString, replaceAll }
  }
  if ((raw.first_line === undefined) !== (raw.last_line === undefined)) {
    throw new Error(`edits[${index}]: first_line and last_line must appear together`)
  }
  if (raw.first_line !== undefined && raw.last_line !== undefined) {
    const firstLine = raw.first_line
    const lastLine = raw.last_line
    if (!Number.isInteger(firstLine) || !Number.isInteger(lastLine) || firstLine < 1 || lastLine < firstLine) {
      throw new Error(`edits[${index}]: first_line and last_line must be integers with 1 <= first_line <= last_line`)
    }
    return { kind: 'lines', firstLine, lastLine, newString }
  }
  if (raw.after_line !== undefined) {
    const afterLine = raw.after_line
    if (!Number.isInteger(afterLine) || afterLine < 0) {
      throw new Error(`edits[${index}]: after_line must be a non-negative integer (0 inserts at the top)`)
    }
    if (newString.length === 0) throw new Error(`edits[${index}]: insert entries require a non-empty new_string`)
    return { kind: 'insert', afterLine, newString }
  }
  throw new Error(`edits[${index}]: use exactly one form — old_string, pattern, first_line/last_line, or after_line`)
}

/** Every non-overlapping occurrence of `search`, in order. */
function matchOffsets(content: string, search: string): number[] {
  const offsets: number[] = []
  let offset = 0
  while (true) {
    const match = content.indexOf(search, offset)
    if (match < 0) return offsets
    offsets.push(match)
    offset = match + search.length
  }
}

/**
 * Fold compiled entries over one text; a later entry addresses the text the
 * earlier ones produced. A failing entry throws an `FsError` carrying its index,
 * so no partial batch ever reaches a commit.
 * @param before - the stream the program runs on, LF-split for line forms.
 * @param entries - the compiled operations in model order.
 * @returns the transformed text plus per-entry match accounting.
 */
export function applyProgram(before: string, entries: readonly CompiledEntry[]): { after: string; outcomes: EntryOutcome[] } {
  let text = before
  const outcomes: EntryOutcome[] = []
  for (const [index, entry] of entries.entries()) {
    if (entry.kind === 'literal') {
      const offsets = matchOffsets(text, entry.oldString)
      const first = offsets[0]
      if (first === undefined) {
        throw new FsError(`edits[${index}]: old_string did not appear verbatim in the file`, 'FS_EDIT_NOT_FOUND')
      }
      if (!entry.replaceAll && offsets.length > 1) {
        throw new FsError(
          `edits[${index}]: old_string appears ${offsets.length} times — set replace_all or add context`,
          'FS_AMBIGUOUS_EDIT',
        )
      }
      text = entry.replaceAll
        ? text.split(entry.oldString).join(entry.newString)
        : text.slice(0, first) + entry.newString + text.slice(first + entry.oldString.length)
      outcomes.push({ index, kind: 'literal', matches: offsets.length })
      continue
    }
    if (entry.kind === 'regex') {
      const global = new RegExp(entry.re.source, entry.re.flags.includes('g') ? entry.re.flags : `${entry.re.flags}g`)
      const matches = [...text.matchAll(global)].length
      if (matches === 0) {
        throw new FsError(`edits[${index}]: pattern matched nothing in the file`, 'FS_EDIT_NOT_FOUND')
      }
      if (!entry.replaceAll && matches > 1) {
        throw new FsError(
          `edits[${index}]: pattern matches ${matches} times — set replace_all or anchor it`,
          'FS_AMBIGUOUS_EDIT',
        )
      }
      // String replacement honors $1-style group references by design.
      text = text.replace(entry.re, entry.newString)
      outcomes.push({ index, kind: 'regex', matches })
      continue
    }
    if (entry.kind === 'lines') {
      const lines = text.split('\n')
      if (entry.lastLine > lines.length) {
        throw new Error(`edits[${index}]: line range ${entry.firstLine}-${entry.lastLine} exceeds the file's ${lines.length} lines`)
      }
      const removed = entry.lastLine - entry.firstLine + 1
      if (entry.newString === '') {
        lines.splice(entry.firstLine - 1, removed)
      } else {
        lines.splice(entry.firstLine - 1, removed, ...entry.newString.split('\n'))
      }
      text = lines.join('\n')
      outcomes.push({ index, kind: 'lines', matches: removed })
      continue
    }
    const lines = text.split('\n')
    if (entry.afterLine > lines.length) {
      throw new Error(`edits[${index}]: after_line ${entry.afterLine} exceeds the file's ${lines.length} lines`)
    }
    const inserted = entry.newString.split('\n')
    lines.splice(entry.afterLine, 0, ...inserted)
    text = lines.join('\n')
    outcomes.push({ index, kind: 'insert', matches: inserted.length })
  }
  return { after: text, outcomes }
}
