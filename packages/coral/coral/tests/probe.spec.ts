import { describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { AcpClientTemplate } from '../../standard-acp/src/index.ts'
import { InprocTransport } from '../../transport-inproc/src/index.ts'
import { endpoint, hostRecord, pair, ref, scriptedPeer } from './helpers.ts'

describe('coral ACP client standard', () => {
  it('probe returns the raw initialize response and closes its connection', async () => {
    const [client, peer] = pair()
    const scripted = scriptedPeer(peer)
    const standard = new AcpClientTemplate()

    const evidence = await standard.probe(client, hostRecord())

    expect(evidence).not.toBeNull()
    expect(evidence?.standard).toBe('acp')
    expect(evidence?.raw).toMatchObject({ protocolVersion: PROTOCOL_VERSION })
    expect(scripted.initializeCount).toBe(1)
    await expect(client.send(new Uint8Array([1]))).rejects.toThrow(/closed/)
  })

  it('client initializes its own connection and prompts the peer', async () => {
    const [probeConnection, probePeerConnection] = pair()
    const probeScripted = scriptedPeer(probePeerConnection)
    const standard = new AcpClientTemplate()
    const evidence = await standard.probe(probeConnection, hostRecord())
    expect(probeScripted.initializeCount).toBe(1)
    expect(evidence).not.toBeNull()

    const [connection, peerConnection] = pair()
    const scripted = scriptedPeer(peerConnection, { reply: 'answer from B' })
    const client = await standard.client(connection, evidence!, hostRecord())
    expect(scripted.initializeCount).toBe(1)
    expect(client.describe()).toBe(evidence!.raw)

    const session = await client.openSession()
    const result = await session.prompt('hello B')
    expect(result.stopReason).toBe('end_turn')
    expect(scripted.prompts).toEqual([{ sessionId: 'session-1', text: 'hello B' }])
    await vi.waitFor(() => { expect(client.updates).toHaveLength(1) })
    await client.dispose()
  })

  it('probe works over a dialed connection, and a dial is consumed once', async () => {
    const transport = new InprocTransport(8)
    const [clientSide, peerSide] = transport.pair(ref('client'), ref('peer'))
    scriptedPeer(peerSide)

    const dialed = await transport.dial(endpoint('client'))
    expect(dialed).toBe(clientSide)
    const evidence = await new AcpClientTemplate().probe(dialed, hostRecord())
    expect(evidence).not.toBeNull()

    await expect(transport.dial(endpoint('client'))).rejects.toThrow(/no inproc listener or pair/)
  })
})
