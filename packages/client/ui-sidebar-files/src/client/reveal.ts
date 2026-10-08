/**
 * The explorer reveal channel and the `sidebarFilesExtensions` contract.
 *
 * Tool rows and the explorer column live in packages that must not import each
 * other, so a reveal is a request on this channel: `revealIn` writes it, and
 * the mounted column is the subscriber that expands and highlights.
 */
import type { } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * One reveal: which session's explorer, and the absolute file path.
 */
export interface FilesRevealRequest {
  /** Session whose explorer column should reveal the file. */
  readonly sessionId: SessionId
  /** Absolute path of the file to expand and highlight. */
  readonly path: string
}

/**
 * Fan-out from `revealIn` to the explorer column mounted for that session.
 */
export interface FilesRevealChannel {
  /**
   * Deliver one reveal to every current subscriber.
   * @param request - the session and absolute path.
   */
  request(request: FilesRevealRequest): void
  /**
   * Receive later reveal requests.
   * @param listener - called with each request.
   * @returns disposer ending the subscription.
   */
  subscribe(listener: (request: FilesRevealRequest) => void): () => void
}

/**
 * Context service the chat view reads when a file row should point at the explorer.
 */
export interface ISidebarFilesExtensions {
  /**
   * Ask the session's explorer column to reveal one file.
   *
   * A column that is not mounted, and a path outside its workspace root, leave
   * the tree unchanged.
   * @param sessionId - session whose column should answer.
   * @param path - absolute path of the file.
   */
  revealIn(sessionId: SessionId, path: string): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Explorer reveal requests from file tool rows. */
    sidebarFilesExtensions: ISidebarFilesExtensions
  }
}

/**
 * Directories from `root` through the parent of `path`, root first.
 *
 * A path that is not strictly inside `root` yields nothing, including a
 * sibling whose name only shares the root's prefix, so the explorer leaves
 * its tree alone.
 * @param root - absolute workspace root the tree is seeded with.
 * @param path - absolute path of the file a reveal asked for.
 * @returns ancestor directories, excluding `path` itself.
 */
export function ancestorsWithin(root: string, path: string): string[] {
  const prefix = `${root}/`
  if (!path.startsWith(prefix)) return []
  const segments = path.slice(root.length + 1).split('/')
  const ancestors = [root]
  let current = root
  for (const segment of segments.slice(0, -1)) {
    current += `/${segment}`
    ancestors.push(current)
  }
  return ancestors
}

/**
 * A reveal channel with no subscribers until a column mounts.
 * @returns the channel `revealIn` writes and the explorer face reads.
 */
export function createRevealChannel(): FilesRevealChannel {
  const listeners = new Set<(request: FilesRevealRequest) => void>()
  return {
    request(request) {
      for (const listener of listeners) listener(request)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
