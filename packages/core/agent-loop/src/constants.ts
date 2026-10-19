/** Shared agent-loop scheduler defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10
/**
 * Config fields whose owner is the per-request grammar fold (the
 * `agent/request` waterfall): they hold exactly one request's worth of
 * lifecycle, so the durable `request/header` must never persist them and
 * request seeds must never inherit them. Any future per-request computation
 * lands here.
 */
export const EPHEMERAL_CONFIG_FIELDS = ['structuredOutput', 'toolChoice'] as const
