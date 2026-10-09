/**
 * The promise-fs adapter: isomorphic-git's read calls translated onto the
 * composed `ctx.fs` filesystem. Mutation-shaped members no-op: isomorphic-git
 * refreshes its `.git/index` cache during status walks, and that bookkeeping
 * must neither persist through this seam nor fail the walk.
 *
 * Every path handed over is absolute in the execution world (isomorphic-git
 * joins it against the repository root it was given), so each call resolves
 * it through `ctx.fs.resolve`. Absence surfaces as an `ENOENT`-coded error
 * because that is the code isomorphic-git recognizes; backend codes that
 * cross this edge are translated here and nowhere else.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FsInfo, FsPathInfo } from '@deepseek-ai/dsh-fs'

/** Node-Stats-shaped facts one synthesized stat carries; times and ids are constant zeros so index comparisons always re-hash. */
interface SyntheticStats {
  readonly ctimeSeconds: number
  readonly ctimeNanoseconds: number
  readonly mtimeSeconds: number
  readonly mtimeNanoseconds: number
  readonly dev: number
  readonly ino: number
  readonly mode: number
  readonly uid: number
  readonly gid: number
  readonly size: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/** The POSIX mode bits per entry kind; `other` reads as a special file. */
function modeOf(type: 'file' | 'directory' | 'symlink' | 'other'): number {
  switch (type) {
    case 'file': return 0o100644
    case 'directory': return 0o040755
    case 'symlink': return 0o120000
    default: return 0o060000
  }
}

/** One stat result as the synthesized Node-Stats object isomorphic-git posixifies. */
function statsOf(type: 'file' | 'directory' | 'symlink' | 'other', size: number | undefined): SyntheticStats {
  return {
    ctimeSeconds: 0,
    ctimeNanoseconds: 0,
    mtimeSeconds: 0,
    mtimeNanoseconds: 0,
    dev: 0,
    ino: 0,
    mode: modeOf(type),
    uid: 0,
    gid: 0,
    size: size ?? 0,
    isFile: () => type === 'file',
    isDirectory: () => type === 'directory',
    isSymbolicLink: () => type === 'symlink',
  }
}

/** An error isomorphic-git reads as ordinary filesystem absence. */
function notFound(path: string): NodeJS.ErrnoException {
  const error = new Error(`ENOENT: no such file or directory: ${path}`) as NodeJS.ErrnoException
  error.code = 'ENOENT'
  return error
}

/** The backend's absence refusal, recognized by its code alone. */
function isAbsent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'FS_NOT_FOUND'
}

/**
 * The adapter isomorphic-git receives as its `fs`. Read members resolve every
 * path through the composed filesystem and translate its refusals; byte caps
 * are the provider's concern, applied after a side is read. The mutation
 * members no-op isomorphic-git's index bookkeeping.
 */
export class FsAdapter {
  /**
   * @param ctx - Host context carrying the composed filesystem.
   */
  constructor(
    private readonly ctx: Context,
  ) {}

  /**
   * One file's bytes through the composed filesystem, translated to
   * `ENOENT` for absence.
   * @param path - absolute execution-world path.
   * @returns the file's bytes.
   */
  async readBytes(path: string): Promise<Uint8Array> {
    const target = await this.ctx.fs.resolve(path).catch((error: unknown) => {
      if (isAbsent(error)) throw notFound(path)
      throw error
    })
    const info = await this.ctx.fs.stat(target)
    if (info === undefined || info.type !== 'file') throw notFound(path)
    try {
      return await this.ctx.fs.readBytes(target, undefined, Number.MAX_SAFE_INTEGER)
    } catch (error: unknown) {
      if (isAbsent(error)) throw notFound(path)
      throw error
    }
  }

  /**
   * Read one file through the composed filesystem; the encoding option
   * mirrors node's promise API, returning a string when named.
   * @param path - absolute execution-world path.
   * @param options - node-shaped options; `utf8` decodes the bytes.
   * @returns the bytes, or their UTF-8 text under the encoding option.
   */
  private async read(path: string, options?: { readonly encoding?: 'utf8' } | 'utf8'): Promise<Uint8Array | string> {
    const bytes = await this.readBytes(path)
    const encoding = typeof options === 'string' ? options : options?.encoding
    return encoding === 'utf8' ? Buffer.from(bytes).toString('utf8') : bytes
  }

  /** The promise API isomorphic-git's `bindFs`-shaped consumers read. */
  readonly promises = {
    readFile: (path: string, options?: { readonly encoding?: 'utf8' } | 'utf8') => this.read(path, options),
    readdir: async (path: string): Promise<string[]> => {
      const target = await this.ctx.fs.resolve(path).catch((error: unknown) => {
        if (isAbsent(error)) throw notFound(path)
        throw error
      })
      const entries = await this.ctx.fs.listDir(target).catch((error: unknown) => {
        if (isAbsent(error)) throw notFound(path)
        throw error
      })
      return entries.map(entry => entry.name)
    },
    stat: async (path: string): Promise<SyntheticStats> => {
      const target = await this.ctx.fs.resolve(path).catch((error: unknown) => {
        if (isAbsent(error)) throw notFound(path)
        throw error
      })
      const info: FsInfo | undefined = await this.ctx.fs.stat(target)
      if (info === undefined) throw notFound(path)
      return statsOf(info.type === 'other' ? 'other' : info.type, info.size)
    },
    lstat: async (path: string): Promise<SyntheticStats> => {
      const info: FsPathInfo | undefined = await this.ctx.fs.lstat(path)
      if (info === undefined) throw notFound(path)
      return statsOf(info.type === 'other' ? 'other' : info.type, info.size)
    },
    readlink: async (path: string): Promise<string> => {
      // The composed fs exposes no link target read; a link is observed as
      // its own entry and its target never resolved through this adapter.
      throw notFound(path)
    },
    symlink: async (): Promise<void> => {},
    writeFile: async (): Promise<void> => {},
    unlink: async (): Promise<void> => {},
    mkdir: async (): Promise<void> => {},
    rmdir: async (): Promise<void> => {},
  }
}
