import { Service, type Context } from '@deepseek-ai/cordis'
import { HostRegistry } from '@deepseek-ai/dsh-coral-host-registry'
import { TransportRegistry } from '@deepseek-ai/dsh-coral-transport-registry'
import { ClientTemplateRegistry } from '@deepseek-ai/dsh-coral-client-standard-registry'
import type { HostEndpoint, HostRecord, ProbeEvidence } from '@deepseek-ai/dsh-coral'

export class HostDiscovery extends Service {
  constructor(ctx: Context) {
    super(ctx, 'coralDiscovery')
  }

  private hosts(): HostRegistry {
    return this.ctx.get('coralHosts', false) as HostRegistry
  }

  private transports(): TransportRegistry {
    return this.ctx.get('coralTransports', false) as TransportRegistry
  }

  private standards(): ClientTemplateRegistry {
    return this.ctx.get('coralClientStandards', false) as ClientTemplateRegistry
  }

  async discover(endpoints: readonly HostEndpoint[]): Promise<HostRecord> {
    const host = this.hosts().upsert({ endpoints })
    await this.probe(host)
    return host
  }

  async probe(host: HostRecord): Promise<readonly ProbeEvidence[]> {
    const hosts = this.hosts()
    const transports = this.transports()
    const standards = this.standards()
    const found: ProbeEvidence[] = []

    for (const endpoint of host.endpoints) {
      const transport = transports.get(endpoint.transport)
      if (transport === null) {
        hosts.setState(host.id, endpoint.id, 'unreachable')
        continue
      }
      for (const standard of standards.list()) {
        hosts.setState(host.id, endpoint.id, 'probing')
        try {
          const connection = await transport.dial(endpoint, {})
          const evidence = await standard.probe(connection, host)
          if (evidence === null) {
            hosts.setState(host.id, endpoint.id, 'unreachable')
            continue
          }
          hosts.setSupport(host.id, endpoint.id, standard.id, evidence)
          hosts.setState(host.id, endpoint.id, 'reachable')
          found.push(evidence)
        } catch {
          hosts.setState(host.id, endpoint.id, 'unreachable')
        }
      }
    }

    return found
  }
}

export const hostDiscovery = {
  name: 'coral.host.discovery',
  apply(ctx: Context): void {
    void new HostDiscovery(ctx)
  },
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    coralDiscovery: HostDiscovery
  }
}
