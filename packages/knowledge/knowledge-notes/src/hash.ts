/**
 * The one content contract of the knowledge-notes domain: the normalized form
 * a note hashes, shared by staleness detection and affirmation.
 *
 * @module @deepseek-ai/dsh-knowledge-notes/hash
 */

import { createHash } from 'node:crypto'
import { HASH_SCHEME } from './types.ts'

/**
 * The normalized form a note hashes. It absorbs the two ways a file changes
 * without changing meaning — a formatter run and an editor round-trip — and
 * nothing else, because an identifier is semantic content.
 * @param text - the target file's decoded contents.
 * @returns the normalized text whose hash is stored as `affirmedAgainst`.
 */
export function normalizeSource(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n') // line endings
    .replace(/[ \t]+$/gmu, '') // trailing space on any line
    .replace(/\n{3,}/gu, '\n\n') // runs of blank lines
}

/**
 * Hash the normalized form of a source file.
 * @param text - the target file's decoded contents.
 * @returns the scheme-prefixed digest stored as `affirmedAgainst`.
 */
export function sourceHash(text: string): string {
  return `sha256:${createHash('sha256').update(normalizeSource(text), 'utf8').digest('hex')}`
}

/** The one scheme this build writes; stored notes carrying another scheme read as stale. */
export { HASH_SCHEME }
