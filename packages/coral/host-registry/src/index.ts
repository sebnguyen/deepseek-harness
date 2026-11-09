import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  EndpointId,
  EndpointState,
  HostEndpoint,
  HostId,
  HostRecord,
  ProbeEvidence,
  StandardId,
} from '@deepseek-ai/dsh-coral'

export class HostRegistry extends Service {
  private readonly hosts = new Map<HostId, HostRecord>()

  constructor(ctx: Context) {
    super(ctx, 'coralHosts')
  }

  upsert(input: { id?: HostId; endpoints: readonly HostEndpoint[] }): HostRecord {
    const id = input.id ?? (randomUUID() as HostId)
    const states = new Map<EndpointId, EndpointState>()
    for (const endpoint of input.endpoints) states.set(endpoint.id, 'unknown')
    const record: HostRecord = { id, endpoints: input.endpoints, supports: new Map(), states }
    this.hosts.set(id, record)
    return record
  }

  get(id: HostId): HostRecord | null {
    return this.hosts.get(id) ?? null
  }

  byUrl(url: URL): HostRecord | null {
    for (const host of this.hosts.values()) {
      for (const endpoint of host.endpoints) {
        if (endpoint.url?.href === url.href) return host
      }
    }
    return null
  }

  findEndpoint(endpoint: EndpointId): { host: HostRecord; endpoint: HostEndpoint } | null {
    for (const host of this.hosts.values()) {
      const found = host.endpoints.find(candidate => candidate.id === endpoint)
      if (found !== undefined) return { host, endpoint: found }
    }
    return null
  }

  setSupport(host: HostId, endpoint: EndpointId, standard: StandardId, evidence: ProbeEvidence): void {
    const record = this.hosts.get(host)
    if (record === undefined) return
    let byStandard = record.supports.get(endpoint)
    if (byStandard === undefined) {
      byStandard = new Map()
      record.supports.set(endpoint, byStandard)
    }
    byStandard.set(standard, evidence)
  }

  setState(host: HostId, endpoint: EndpointId, state: EndpointState): void {
    this.hosts.get(host)?.states.set(endpoint, state)
  }

  list(): readonly HostRecord[] {
    return [...this.hosts.values()]
  }

  remove(id: HostId): void {
    this.hosts.delete(id)
  }
}

export const hostRegistry = {
  name: 'coral.host.registry',
  apply(ctx: Context): void {
    void new HostRegistry(ctx)
  },
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    coralHosts: HostRegistry
  }
}
