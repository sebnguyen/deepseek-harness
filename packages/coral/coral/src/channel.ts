/**
 * Channel: the Codec ∘ Connection composition. Owns a method router, request
 * correlation, and optional reconnect policy (never inside Connection itself).
 */

import { MethodRegistry } from './shell.ts'
import type {
  Channel,
  ChannelPolicy,
  Codec,
  CodecId,
  Connection,
  Disposable,
  Listener,
  MethodHandler,
  ServerTemplate,
  WireMessage,
} from './types.ts'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

type RouterRow = { readonly context: unknown; readonly result: unknown }
type Router = MethodRegistry<Record<string, RouterRow>>

// {i, m, p} request · {i, r|e} response · {n, m, p} notification
type WireEnvelope =
  | { readonly i: number; readonly m: string; readonly p?: unknown }
  | { readonly i: number; readonly r?: unknown; readonly e?: string }
  | { readonly n: true; readonly m: string; readonly p?: unknown }

interface Pending {
  readonly method: string
  readonly payload: unknown
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

function envelopeOf(value: unknown): WireEnvelope | null {
  if (value === null || typeof value !== 'object') return null
  return value as WireEnvelope
}

function errorOf(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/** Bind one method handler into a channel router and return its unbind. */
function bindHandler(
  router: Router,
  unbinds: Disposable[],
  disposed: boolean,
  method: string,
  handler: MethodHandler,
): Disposable {
  if (disposed) throw new Error('coral: channel is disposed')
  const unbind = router.bind(method, handler as (context: RouterRow['context']) => RouterRow['result'] | Promise<RouterRow['result']>)
  unbinds.push(unbind)
  return {
    dispose: () => {
      unbind.dispose()
      const index = unbinds.indexOf(unbind)
      if (index >= 0) unbinds.splice(index, 1)
    },
  }
}

/** One Channel over one already-established Connection. */
export class LinkChannel implements Channel {
  readonly codecId: CodecId
  private readonly router: Router = new MethodRegistry<Record<string, RouterRow>>()
  private readonly unbinds: Disposable[] = []
  private readonly pending = new Map<number, Pending>()
  private readonly decoder: ReturnType<Codec['decoder']>
  private counter = 0
  private disposed = false

  constructor(
    private readonly conn: Connection,
    private readonly codec: Codec,
    private readonly policy: ChannelPolicy | undefined,
    private readonly onClosed?: (link: LinkChannel) => void,
  ) {
    this.codecId = codec.id
    this.decoder = codec.decoder()
    void this.run().catch(() => {})
  }

  private async send(envelope: WireEnvelope): Promise<void> {
    for (const frame of this.codec.encode(envelope as unknown as WireMessage)) {
      await this.conn.send(frame)
    }
  }

  private async run(): Promise<void> {
    try {
      for await (const frame of this.conn.read) {
        for (const raw of this.decoder.push(frame)) this.handle(envelopeOf(raw))
      }
    } finally {
      this.onEof()
    }
  }

  private onEof(): void {
    if (this.disposed) return
    if (this.onClosed !== undefined) {
      this.onClosed(this)
      return
    }
    this.rejectPending(new Error('coral: connection closed'))
  }

  private rejectPending(error: Error): void {
    for (const entry of this.pending.values()) {
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }

  /** Detach pending entries (reconnect moves or rejects them); clears timers. */
  detachPending(): Pending[] {
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const entry of entries) {
      if (entry.timer !== undefined) clearTimeout(entry.timer)
    }
    return entries
  }

  issue(method: string, payload: unknown, resolve: (value: unknown) => void, reject: (error: Error) => void): void {
    const id = ++this.counter
    const entry: Pending = { method, payload, resolve, reject }
    this.pending.set(id, entry)
    if (this.policy?.requestTimeoutMs !== undefined) {
      entry.timer = setTimeout(() => {
        if (this.pending.get(id) !== entry) return
        this.pending.delete(id)
        reject(new Error(`coral: request timed out: ${method}`))
      }, this.policy.requestTimeoutMs)
    }
    void this.send({ i: id, m: method, p: payload }).catch((error: unknown) => {
      if (this.pending.get(id) !== entry) return
      this.pending.delete(id)
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      reject(errorOf(error))
    })
  }

  private handle(raw: WireEnvelope | null): void {
    if (raw === null) return
    if ('n' in raw) {
      void this.router.dispatch(raw.m, raw.p).catch(() => {})
      return
    }
    if (!('m' in raw)) {
      const entry = this.pending.get(raw.i)
      if (entry === undefined) return
      this.pending.delete(raw.i)
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      if (raw.e !== undefined) entry.reject(new Error(raw.e))
      else entry.resolve(raw.r)
      return
    }
    void this.answer(raw.i, raw.m, raw.p)
  }

  private async answer(id: number, method: string, payload: unknown): Promise<void> {
    try {
      const result = await this.router.dispatch(method, payload)
      await this.send({ i: id, r: result })
    } catch (error) {
      try {
        await this.send({ i: id, e: errorOf(error).message })
      } catch {
        /* link already gone */
      }
    }
  }

  request(method: string, payload: unknown): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('coral: channel is disposed'))
    return new Promise<unknown>((resolve, reject) => { this.issue(method, payload, resolve, reject) })
  }

  subscribe(method: string, handler: MethodHandler): Disposable {
    return bindHandler(this.router, this.unbinds, this.disposed, method, handler)
  }

  notify(method: string, payload: unknown): void {
    if (this.disposed) return
    void this.send({ n: true, m: method, p: payload }).catch(() => {})
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const unbind of this.unbinds.splice(0)) unbind.dispose()
    this.router.dispose()
    this.rejectPending(new Error('coral: channel is disposed'))
    await this.conn.dispose()
  }
}

/** Channel over a dialer, re-dialing through the policy when a link dies. */
export class ReconnectingChannel implements Channel {
  readonly codecId: CodecId
  private link: LinkChannel | null = null
  private disposed = false
  private started = false
  private readonly subs: Array<{ readonly method: string; readonly handler: MethodHandler }> = []
  private readonly binds: Disposable[] = []
  private readonly doors: Array<{ readonly ready: (link: LinkChannel) => void; readonly fail: (error: Error) => void }> = []

  constructor(
    private readonly opener: () => Connection | Promise<Connection>,
    private readonly codec: Codec,
    private readonly policy: ChannelPolicy | undefined,
  ) {
    this.codecId = codec.id
  }

  private ensureStarted(): void {
    if (this.started) return
    this.started = true
    void this.attempt()
  }

  private async attempt(): Promise<void> {
    try {
      const conn = await this.opener()
      if (this.disposed) {
        await conn.dispose()
        return
      }
      const link = new LinkChannel(conn, this.codec, this.policy, (closed) => { void this.onEof(closed) })
      this.link = link
      for (const sub of this.subs) this.binds.push(link.subscribe(sub.method, sub.handler))
      for (const door of this.doors.splice(0)) door.ready(link)
    } catch (error) {
      const reconnect = this.policy?.reconnect
      if (this.disposed || reconnect === undefined || reconnect.maxAttempts <= 0) {
        this.fail(errorOf(error))
        return
      }
      await sleep(reconnect.backoffMs)
      if (!this.disposed) void this.attempt()
    }
  }

  private async onEof(link: LinkChannel): Promise<void> {
    if (this.disposed || this.link !== link) return
    this.link = null
    for (const unbind of this.binds.splice(0)) unbind.dispose()
    const pendings = link.detachPending()
    const reconnect = this.policy?.reconnect
    if (reconnect === undefined) {
      this.fail(new Error('coral: connection closed'))
      return
    }
    for (let attempt = 0; attempt < reconnect.maxAttempts; attempt++) {
      await sleep(reconnect.backoffMs)
      if (this.disposed) {
        this.rejectAll(pendings, new Error('coral: channel is disposed'))
        return
      }
      try {
        const conn = await this.opener()
        const next = new LinkChannel(conn, this.codec, this.policy, (closed) => { void this.onEof(closed) })
        this.link = next
        for (const sub of this.subs) this.binds.push(next.subscribe(sub.method, sub.handler))
        for (const entry of pendings) {
          if (reconnect.idempotent?.(entry.method) !== true) {
            entry.reject(new Error(`coral: connection closed during non-idempotent request: ${entry.method}`))
          } else {
            next.issue(entry.method, entry.payload, entry.resolve, entry.reject)
          }
        }
        for (const door of this.doors.splice(0)) door.ready(next)
        return
      } catch {
        /* retry */
      }
    }
    this.rejectAll(pendings, new Error('coral: channel closed: reconnect attempts exhausted'))
    this.fail(new Error('coral: channel closed: reconnect attempts exhausted'))
  }

  private rejectAll(pendings: readonly Pending[], error: Error): void {
    for (const entry of pendings) entry.reject(error)
  }

  private fail(error: Error): void {
    const doors = this.doors.splice(0)
    for (const door of doors) door.fail(error)
  }

  request(method: string, payload: unknown): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('coral: channel is disposed'))
    this.ensureStarted()
    const link = this.link
    if (link !== null) return link.request(method, payload)
    return new Promise<unknown>((resolve, reject) => {
      this.doors.push({
        ready: (ready) => { ready.issue(method, payload, resolve, reject) },
        fail: (fail) => { reject(fail) },
      })
    })
  }

  subscribe(method: string, handler: MethodHandler): Disposable {
    if (this.disposed) throw new Error('coral: channel is disposed')
    const record = { method, handler }
    this.subs.push(record)
    const link = this.link
    let unbind: Disposable | null = null
    if (link !== null) {
      unbind = link.subscribe(method, handler)
      this.binds.push(unbind)
    }
    return {
      dispose: () => {
        const index = this.subs.indexOf(record)
        if (index >= 0) this.subs.splice(index, 1)
        if (unbind !== null) {
          unbind.dispose()
          const bindIndex = this.binds.indexOf(unbind)
          if (bindIndex >= 0) this.binds.splice(bindIndex, 1)
        }
      },
    }
  }

  notify(method: string, payload: unknown): void {
    this.link?.notify(method, payload)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const unbind of this.binds.splice(0)) unbind.dispose()
    this.fail(new Error('coral: channel is disposed'))
    await this.link?.dispose()
  }
}

/** Server-side Channel: the router serves every accepted link; notify broadcasts. */
export class AcceptChannel implements Channel {
  readonly codecId: CodecId
  private readonly router: Router = new MethodRegistry<Record<string, RouterRow>>()
  private readonly peers = new Map<string, { readonly conn: Connection; readonly decoder: ReturnType<Codec['decoder']> }>()
  private readonly unbinds: Disposable[] = []
  private disposed = false

  constructor(
    private readonly listener: Listener,
    private readonly codec: Codec,
  ) {
    this.codecId = codec.id
    void this.run().catch(() => {})
  }

  private async run(): Promise<void> {
    for await (const conn of this.listener.accept()) {
      if (this.disposed) {
        await conn.dispose()
        return
      }
      const peer = { conn, decoder: this.codec.decoder() }
      this.peers.set(conn.id, peer)
      void this.serve(peer)
    }
  }

  private async serve(peer: { readonly conn: Connection; readonly decoder: ReturnType<Codec['decoder']> }): Promise<void> {
    try {
      for await (const frame of peer.conn.read) {
        for (const raw of peer.decoder.push(frame)) await this.handle(peer, envelopeOf(raw))
      }
    } finally {
      this.peers.delete(peer.conn.id)
    }
  }

  private async handle(peer: { readonly conn: Connection }, raw: WireEnvelope | null): Promise<void> {
    if (raw === null) return
    if ('n' in raw) {
      await this.router.dispatch(raw.m, raw.p).catch(() => {})
      return
    }
    if (!('m' in raw)) return // the accept side does not issue requests in slice 1
    try {
      const result = await this.router.dispatch(raw.m, raw.p)
      await this.sendTo(peer, { i: raw.i, r: result })
    } catch (error) {
      try {
        await this.sendTo(peer, { i: raw.i, e: errorOf(error).message })
      } catch {
        /* peer already gone */
      }
    }
  }

  private async sendTo(peer: { readonly conn: Connection }, envelope: WireEnvelope): Promise<void> {
    for (const frame of this.codec.encode(envelope as unknown as WireMessage)) {
      await peer.conn.send(frame)
    }
  }

  request(_method: string, _payload: unknown): Promise<unknown> {
    return Promise.reject(new Error('coral: accept channel has no single peer to request'))
  }

  subscribe(method: string, handler: MethodHandler): Disposable {
    return bindHandler(this.router, this.unbinds, this.disposed, method, handler)
  }

  notify(method: string, payload: unknown): void {
    for (const peer of this.peers.values()) {
      void this.sendTo(peer, { n: true, m: method, p: payload }).catch(() => {})
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const unbind of this.unbinds.splice(0)) unbind.dispose()
    this.router.dispose()
    const peers = [...this.peers.values()]
    this.peers.clear()
    for (const peer of peers) await peer.conn.dispose()
    await this.listener.dispose()
  }
}

/** One Channel over one established Connection; no reconnect. */
export function linkChannel(connection: Connection, codec: Codec, policy?: ChannelPolicy): Channel {
  return new LinkChannel(connection, codec, policy)
}

/** Channel over a dialer with policy-managed reconnect. */
export function channel(open: () => Connection | Promise<Connection>, codec: Codec, policy?: ChannelPolicy): Channel {
  return new ReconnectingChannel(open, codec, policy)
}

/** Server-side Channel over a welcomer: one router, all accepted links. */
export function acceptChannel(listener: Listener, codec: Codec, _policy?: ChannelPolicy): Channel {
  return new AcceptChannel(listener, codec)
}

/** Mount a standard's method table onto a Channel: one subscription per row. */
export function mountTemplate(template: ServerTemplate, target: Channel): Disposable {
  const unbinds: Disposable[] = []
  for (const [method, handler] of Object.entries(template.methods)) {
    unbinds.push(target.subscribe(method, handler))
  }
  for (const notification of template.notifications ?? []) {
    unbinds.push(target.subscribe(notification, () => undefined))
  }
  return {
    dispose: () => {
      for (const unbind of unbinds.reverse()) unbind.dispose()
    },
  }
}
