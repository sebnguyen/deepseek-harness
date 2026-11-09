import type { Context } from '@deepseek-ai/cordis'
import type { Cluster } from '@deepseek-ai/dsh-coral'

export function clusterPlugin(cluster: Cluster) {
  return {
    name: 'coral.cluster',
    apply(ctx: Context): void | Promise<void> {
      return cluster.apply(ctx)
    },
  }
}
