/** Environment-independent Cordis runtime tree reader. */

import type { CordisRuntimeTree } from './model.ts'
import type { CordisServiceGetQuery, CordisServicePreview } from '../bridge/messages/query/commands.ts'

/** Read-only access to the latest committed consumer-neutral Cordis tree. */
export interface CordisRuntimeTreeReader {
  /**
   * Read the latest Worker snapshot without activating CDP domains.
   * @returns A detached Host and Client Cordis tree.
   * @throws When the source transport is unavailable, closes, times out, or rejects the query.
   */
  getTree(): Promise<CordisRuntimeTree>

  /** Read one selected service fresh from its owning realm when requested. */
  getService(query: CordisServiceGetQuery): Promise<CordisServicePreview>
}

/**
 * Create a reader around a local committed-tree projection.
 * @param read - Synchronous or asynchronous latest-tree read.
 * @returns A reader suitable for query and CDP adapters.
 */
export function createCordisRuntimeTreeReader(
  read: () => CordisRuntimeTree | Promise<CordisRuntimeTree>,
  readService?: (query: CordisServiceGetQuery) => Promise<CordisServicePreview>,
): CordisRuntimeTreeReader {
  return {
    getTree: async () => await read(),
    getService: async (query) => {
      if (readService === undefined) throw new Error('Cordis service evaluation is not configured')
      return readService(query)
    },
  }
}
