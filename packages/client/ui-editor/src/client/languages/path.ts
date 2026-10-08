/**
 * The path parse language detection and the Markdown display claim share, so
 * the two cannot drift apart on what a suffix means.
 *
 * Both separators are honored: a file opened from a Windows session carries
 * backslashes, and detection must not fall back to plain text because of it.
 */

/**
 * The final segment of one path, in whatever case it carries.
 * @param path - the file path a tab addresses.
 * @returns the last segment; the whole path when it carries no separator.
 */
export function fileNameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/**
 * The dotted lowercase suffix one path carries, or the empty string.
 *
 * A leading dot belongs to the name, not to a suffix: `.bashrc` has none, which
 * is what the registry's file-name table is for.
 * @param path - the file path a tab addresses.
 * @returns `.ext` from the last segment, lowercased; `''` without one.
 */
export function extensionOf(path: string): string {
  const base = fileNameOf(path)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}
