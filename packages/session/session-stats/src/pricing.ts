/**
 * Host owner of the `sessionStats` pricing Remote namespace: the deployment
 * rate table configuration surfaces read, exactly as stored. The fold the
 * projection runs stays private; only deployment-declared rates cross, and
 * a deployment that declared none answers an absent table rather than a
 * fabricated one.
 *
 * @module @deepseek-ai/dsh-session-stats/pricing.ts
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CostPricing } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `sessionStats` Remote namespace. */
    sessionStatsPricing: SessionStatsPricingController
  }
}

/**
 * Host service backing the generated `ctx.remote.sessionStats` namespace.
 * The plugin that registers the cost projection passes that same table in,
 * so the fold and the read can never disagree about a rate.
 */
export class SessionStatsPricingController extends TypertRemoteService {
  /**
   * @param ctx - Host context carrying the typert registry.
   * @param options - the deployment rates the cost fold runs on, absent when the deployment priced nothing.
   */
  constructor(ctx: Context, options: { pricing?: CostPricing | undefined }) {
    super(ctx, 'sessionStatsPricing', { namespace: 'sessionStats' })
    this.pricing = options.pricing
  }

  private readonly pricing: CostPricing | undefined

  /**
   * The deployment rate table for configuration surfaces.
   * @returns flat rates plus the per-model map; absent when the deployment declared none.
   */
  @Remote
  describePricing(): Promise<CostPricing | undefined> {
    return Promise.resolve(this.pricing === undefined ? undefined : { ...this.pricing })
  }
}
