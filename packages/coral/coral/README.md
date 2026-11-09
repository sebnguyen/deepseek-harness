# @deepseek-ai/dsh-coral

Coral core: shared types, method registry, ACP constants/connection stream, and errors. The
active implementations are their own packages under `packages/coral/` with
`@deepseek-ai/dsh-coral-<folder>` names: transports, registries, ACP client/server, peer services,
and the Cluster factory. The core package itself contains no plugin implementations.

A `Server` is an advertisement, not a connection shell: `ServerRegistry.register` resolves the
standard's no-op method table and `Server.bind` overwrites handlers. Registration also claims
`(transport, standard)` through `coralTransports`: `shared` transports allow many Servers,
`exclusive` transports allow one. `accept(connection, match?)` links a server-side connection by
optional `key` and `standard`; there is no protocol dispatch yet. A `Cluster` has one key, can
register N Servers, and sees only the Clients whose `owner` is that key through
`ClientRegistry.scope(key)`.

Run `examples/multi-cluster-acp.sh` for a two-Cluster inproc ACP demo: both Clusters register
`inproc`/`acp`, accept by key, discover each other, and exchange real ACP prompts.

`coral.standard.acp` outputs both `AcpClientTemplate` and `AcpServerTemplate`. `AgentSource`,
`serveAcpAgent`, model-facing tool registration (`peer_list`/`peer_describe`), a fixed ACP tool
suite, and the orchestrator are not in this slice. The 23 specs under `tests/` cover the transport
contract, transient probe, discovery, multiplex, churn, a child-process stdio peer, raw JSON-RPC
shape checks over four transport paths, the method registry, ACP template registration, transport
claims, connection acceptance, and Cluster server/client scoping. See `agent-note-coral-engine.md` and `agent-note-coral-client-server.md` at
the workspace root for the contract.
