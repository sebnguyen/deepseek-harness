/**
 * Readable-answers conversation rules: one static system-prompt section
 * carrying four evidence-grounded core rules. No tools, no state, no config —
 * the entire design is prompt text the model follows.
 */
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-system-prompt'

export const name = 'readability-rules'

export const inject = ['systemPrompt']

/** The system-prompt section name under which the plain-answers rules register. */
export const SECTION_NAME = 'readability:plain-answers'

/** External finite order slot for the section; sits after the first-party guidance range and the staging core rule. */
export const SECTION_ORDER = 143

/**
 * The verbatim section text: the four core readability rules selected by the owner (Answer First,
 * Readable Sentences, One Name Per Concept, Active, Concrete Language), rationale-forward and
 * number-free, per the proposal's prompt-text contract. The cut layout/calibration rules stay in
 * the Agent Note as follow-ups.
 */
export const PLAIN_ANSWERS_RULES = `Core Rule: Answer First - The reader opened the reply for the result, so the conclusion is owed before its justification. Carry the answer at the very start, and let the reasoning follow it. Example: open on "The lock table is full; purge the stale rows", not on "After investigating the failure...".

Core Rule: Readable Sentences - A reader holds a sentence in working memory, and comprehension cost grows with the distance between dependent words. Keep dependents close: close each clause before opening the next, never interpose material between a subject and its verb, and let established information open the sentence while the new claim closes it.

Core Rule: One Name Per Concept - A rename forces the reader to re-resolve whether the old concept returned or a new one began, so a term survives reader attention only while its name stays fixed. State the term with its definition once, then reuse that exact term — never rename it for variety. Example: "session projection" stays "session projection" — not "projection store", not "the folded state".

Core Rule: Active, Concrete Language - Readers parse agency actor-first and act on verbs, while a nominalized action makes them unpack the noun to find the work. Put the actor before the action, default to the active voice, and turn \`-ation\`/\`-ent\` noun phrases back into verbs. Example: "the harness folds events", not "the folding of events is performed by the harness".`

/**
 * Contribute the rules as exactly one system-prompt section; registration is effect-scoped, so
 * disposing the plugin fiber removes the section (HMR-safe by construction).
 * @param ctx - The plugin context; `systemPrompt` is injected.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text: PLAIN_ANSWERS_RULES })
}
