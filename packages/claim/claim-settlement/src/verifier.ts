/**
 * Verifier execution: freeze check, bounded run through the shell seam, and
 * the mapping from one executor result to a claim outcome.
 * @module @deepseek-ai/dsh-claim-settlement
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Verifier, VerifierResult } from '@deepseek-ai/dsh-claim'
import type {} from '@deepseek-ai/dsh-shell'

/**
 * SHA-256 hex of one verifier script, the freeze proof recorded at binding.
 * @param source - the verifier script text.
 * @returns the digest compared against the stored binding before every run.
 */
export function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

/**
 * Keep the tail of one verifier output, bounded so a model-facing result stays
 * affordable.
 * @param evidence - the verifier's own output.
 * @param lines - evidence lines kept from the tail.
 * @returns the bounded tail, or a placeholder when the output is empty.
 */
export function boundedEvidence(evidence: string, lines: number): string {
  const kept = evidence.split('\n').slice(-lines).join('\n').trim()
  return kept.length === 0 ? '(no output)' : kept
}

/**
 * Render one thrown value as evidence text.
 * @param error - the thrown value.
 * @returns the error message, or the string form of a non-Error throw.
 */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Run one bound verifier and classify its result.
 *
 * A verifier that cannot be hashed back to its binding is `tampered`; one the
 * executor killed before it finished is `inconclusive`; a completed run is
 * `pass` or `fail` on its exit code. Infrastructure failures never escape as
 * throws, because a listener throw would close the turn as an error instead of
 * settling the claim.
 *
 * @param ctx - Context carrying the shell executor seam.
 * @param binding - the frozen script and the digest taken at binding.
 * @param timeoutMs - per-run timeout handed to the executor's resolver.
 * @param signal - the owning turn's abort signal, so cancellation converges.
 * @returns the classified outcome with the verifier's own output as evidence.
 */
export async function runVerifier(
  ctx: Context,
  binding: Verifier,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<VerifierResult> {
  if (sha256(binding.source) !== binding.digest) {
    return { outcome: 'tampered', evidence: 'the verifier script changed after it was bound' }
  }
  try {
    const spec = ctx.shell.resolve({ command: binding.source, timeoutMs, signal })
    const result = await ctx.shell.run(spec)
    const output = result.stdout.text
    if (result.timedOut || result.signal !== null) {
      return {
        outcome: 'inconclusive',
        evidence: `the verifier did not finish (${result.timedOut ? 'timeout' : String(result.signal)})\n${output}`,
      }
    }
    return result.exitCode === 0
      ? { outcome: 'pass', evidence: output }
      : { outcome: 'fail', evidence: output }
  } catch (error) {
    return { outcome: 'inconclusive', evidence: `the verifier could not run: ${errorText(error)}` }
  }
}
