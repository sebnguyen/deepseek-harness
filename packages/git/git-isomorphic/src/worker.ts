/**
 * The git-walk worker entry: answers `{ id, dir }` requests over its parent port
 * with the walk's reply or its fault message, keeping isomorphic-git's hashing
 * off the Host event loop. Dev-time module runners (vitest, tsx) boot this `.ts`
 * closure; the built face boots the sibling `worker.cjs` under plain Node.
 *
 * @module @deepseek-ai/dsh-git-isomorphic/worker.ts
 */
import { parentPort } from 'node:worker_threads'
import { faultMessageOf, walkRepository } from './walk.ts'

/** One walk request the runner posts. */
interface WalkRequest {
  readonly id: number
  readonly dir: string
}

const port = parentPort
if (port === null) throw new Error('the git-walk entry runs only as a worker thread')

port.on('message', (message: WalkRequest) => {
  void walkRepository(message.dir).then(
    (reply) => { port.postMessage({ id: message.id, reply }) },
    (error: unknown) => {
      port.postMessage({ id: message.id, error: faultMessageOf(error) })
    },
  )
})
