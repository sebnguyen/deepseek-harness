/**
 * Client-namespace projection of token-meter's browser-safe contracts and folds.
 *
 * @module @deepseek-ai/dsh-token-meter/client
 */

export type * from './projection.ts'
export { deriveTurnTokenUsage } from './turn-usage.ts'
export type { TurnTokenUsage, TurnTokenUsageRoute } from './turn-usage.ts'
export { commitSurfaceTokens, planSurfaceTokens } from './surface-fold.ts'
export type { MeterSurfaceNode, SurfaceTokenPlan } from './surface-fold.ts'
export { estimateMessage, estimateToolsTokens } from './estimate.ts'
