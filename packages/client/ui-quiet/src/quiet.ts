/**
 * Quiet-mode wire constants: the stop tool's name and the empty-object leak
 * shield carried by working steps. The finish one-shot carries neither —
 * only thinking and answer tokens are generated there.
 * @module @deepseek-ai/dsh-client-ui-quiet/quiet
 */

import type { StructuredOutputSchema } from '@deepseek-ai/dsh-llm'

/** Name of the synthetic stop tool present while quiet mode is armed. */
export const QUIET_FINISH_TOOL = 'quiet_finish'

/**
 * Response grammar for quiet working steps: any leaked answer text is bound
 * to `{}` (~2 tokens), so the answer channel stays structurally empty until
 * the finish step drops the shield.
 */
export const EMPTY_OBJECT_SCHEMA: StructuredOutputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
  // The shield only binds with grammar decoding: non-strict json_schema is
  // best-effort and leaks free answer text.
  strict: true,
}
