/**
 * Interpreter recognition for the files whose names decide nothing.
 *
 * `deploy`, `script`, and the shell dotfiles carry no suffix, so the `#!` line
 * is the only statement of intent they make. Only the document's first line is
 * ever consulted; a `#!` further down is a comment.
 */

/**
 * The interpreter one first line names.
 * @param line - the document's first line.
 * @returns the interpreter's basename — `sh` for `#!/bin/sh`, `python3` for
 *   `#!/usr/bin/env python3` — or undefined when the line is not a shebang or
 *   names no command.
 */
export function shebangInterpreter(line: string): string | undefined {
  // A byte-order mark is common on Windows-authored scripts and precedes the `#!`.
  const text = line.startsWith('\uFEFF') ? line.slice(1) : line
  if (!text.startsWith('#!')) return undefined
  const body = text.slice(2).trim()
  const head = firstToken(body)
  if (head === undefined) return undefined
  const name = interpreterName(head)
  if (name !== 'env') return name
  return envCommand(body.slice(head.length))
}

/**
 * The command `env` launches: its first argument that is neither a flag nor a
 * `NAME=value` assignment, so `env -S python3 -u` and `env FOO=bar node` both
 * resolve.
 * @param rest - everything on the line after the `env` token.
 * @returns the command's basename, or undefined when `env` names none.
 */
function envCommand(rest: string): string | undefined {
  for (const token of rest.split(/\s+/)) {
    if (token !== '' && !token.startsWith('-') && !token.includes('=')) return interpreterName(token)
  }
  return undefined
}

/**
 * The first whitespace-delimited token of one already-trimmed string.
 * @param text - the trimmed remainder of a shebang line.
 * @returns the token, or undefined for an empty string.
 */
function firstToken(text: string): string | undefined {
  if (text === '') return undefined
  const space = text.search(/\s/)
  return space === -1 ? text : text.slice(0, space)
}

/**
 * The basename of one interpreter token.
 * @param token - a command path or name.
 * @returns the segment after the last `/`.
 */
function interpreterName(token: string): string {
  return token.slice(token.lastIndexOf('/') + 1)
}
