# Agent Client Protocol v1 — complete API and data-structure reference

Generated directly from the machine-readable v1 schema shipped by the pinned SDK:

| | |
|---|---|
| Source package | `@agentclientprotocol/sdk` 1.4.0 |
| Schema file | `schema/schema.json` (inside the package; this repo does not vendor it) |
| Protocol version | `1` (`PROTOCOL_VERSION`) |
| Published by | Zed Industries / Agent Client Protocol project — https://agentclientprotocol.com/protocol/v1/schema |
| Definitions in this file | 265 |

Upstream lists **v1 as Latest** and **v2 as Draft**; this file documents v1, the version in force.
Areas the schema marks `UNSTABLE`/experimental are labelled inline.

## 1. Wire protocol

- **JSON-RPC 2.0** objects, **newline-delimited JSON** (one object per line).
- **Default transport: stdio** — agent reads `stdin`, writes `stdout`; `stderr` is free for logs. Upstream also documents socket/HTTP transports.
- Request/response/notification envelopes are the `AgentRequest`, `ClientRequest`, `AgentResponse`, `ClientResponse`, `AgentNotification`, `ClientNotification` definitions.
- Version negotiation happens once, in `initialize`: the client sends its version, the agent answers with the version it will use.
- Capability negotiation is per-direction: `ClientCapabilities` (client to agent) and `AgentCapabilities` (agent to client). Optional methods are legal only when the other side advertised support.
- `_meta?: Record<string, unknown>` on most types is the official extension slot; implementations must not assign meaning to foreign keys.
- Turns end with a `StopReason`; cancellation is `session/cancel` plus the protocol-level `$/cancel_request`.

### Agent methods (client to agent)

| Method | Params | Result | Notes |
|---|---|---|---|
| `initialize` | `InitializeRequest` | `InitializeResponse` | Negotiate protocol version + capabilities. First call on every connection. |
| `authenticate` | `AuthenticateRequest` | `AuthenticateResponse` | Run one advertised auth method; only when `authMethods` is non-empty. |
| `logout` | `LogoutRequest` | `LogoutResponse` | Discard stored credentials; needs the agent `auth.logout` capability. |
| `providers/list` | `ListProvidersRequest` | `ListProvidersResponse` | List available model providers. |
| `providers/set` | `SetProviderRequest` | `SetProviderResponse` | Select a model provider. |
| `providers/disable` | `DisableProviderRequest` | `DisableProviderResponse` | Disable a model provider. |
| `session/new` | `NewSessionRequest` | `NewSessionResponse` | Create a session: absolute cwd, MCP servers, returns sessionId + config options. |
| `session/load` | `LoadSessionRequest` | `LoadSessionResponse` | Replay a stored session, replaying its updates to the client. |
| `session/list` | `ListSessionsRequest` | `ListSessionsResponse` | Page through stored sessions. |
| `session/delete` | `DeleteSessionRequest` | `DeleteSessionResponse` | Delete a stored session. |
| `session/fork` | `ForkSessionRequest` | `ForkSessionResponse` | Branch an existing session. |
| `session/resume` | `ResumeSessionRequest` | `ResumeSessionResponse` | Reopen a stored session without replaying history. |
| `session/close` | `CloseSessionRequest` | `CloseSessionResponse` | Close a session and release its resources. |
| `session/set_mode` | `SetSessionModeRequest` | `SetSessionModeResponse` | Switch the session mode. |
| `session/set_config_option` | `SetSessionConfigOptionRequest` | `SetSessionConfigOptionResponse` | Set one advertised config option; returns the full option state. |
| `session/prompt` | `PromptRequest` | `PromptResponse` | Send the turn; resolves with a stopReason. |
| `session/cancel` | `CancelNotification` | none | Notification: cancel in-flight work for a session. |
| `nes/start` | `StartNesRequest` | `StartNesResponse` | EXPERIMENTAL next-edit-suggestions: start a NES session. |
| `nes/suggest` | `SuggestNesRequest` | `SuggestNesResponse` | EXPERIMENTAL: request edit suggestions for a context. |
| `nes/accept` | `AcceptNesNotification` | none | EXPERIMENTAL notification: accept a suggestion. |
| `nes/reject` | `RejectNesNotification` | none | EXPERIMENTAL notification: reject a suggestion. |
| `nes/close` | `CloseNesRequest` | `CloseNesResponse` | EXPERIMENTAL: close a NES session. |
| `document/didOpen` | `DidOpenDocumentNotification` | none | EXPERIMENTAL notification: document opened. |
| `document/didChange` | `DidChangeDocumentNotification` | none | EXPERIMENTAL notification: document changed. |
| `document/didClose` | `DidCloseDocumentNotification` | none | EXPERIMENTAL notification: document closed. |
| `document/didSave` | `DidSaveDocumentNotification` | none | EXPERIMENTAL notification: document saved. |
| `document/didFocus` | `DidFocusDocumentNotification` | none | EXPERIMENTAL notification: document focused. |

### Client methods (agent to client)

| Method | Params | Result | Notes |
|---|---|---|---|
| `session/update` | none | `SessionNotification` | NOTIFICATION agent to client carrying one SessionUpdate. |
| `session/request_permission` | `RequestPermissionRequest` | `RequestPermissionResponse` | Ask the client to allow or reject one tool call. |
| `fs/read_text_file` | `ReadTextFileRequest` | `ReadTextFileResponse` | Needs the client `fs.readTextFile` capability. |
| `fs/write_text_file` | `WriteTextFileRequest` | `WriteTextFileResponse` | Needs the client `fs.writeTextFile` capability. |
| `terminal/create` | `CreateTerminalRequest` | `CreateTerminalResponse` | Needs the client terminal capability. |
| `terminal/output` | `TerminalOutputRequest` | `TerminalOutputResponse` | Read terminal output and exit status. |
| `terminal/wait_for_exit` | `WaitForTerminalExitRequest` | `WaitForTerminalExitResponse` | Block until the command exits. |
| `terminal/kill` | `KillTerminalRequest` | `KillTerminalResponse` | Kill the command. |
| `terminal/release` | `ReleaseTerminalRequest` | `ReleaseTerminalResponse` | Release the terminal. |
| `elicitation/create` | `CreateElicitationRequest` | `CreateElicitationResponse` | Ask the user for structured input. |
| `elicitation/complete` | `CompleteElicitationNotification` | none | NOTIFICATION: elicitation resolved. |

Protocol level: `$/cancel_request` (`CancelRequestNotification`) cancels a request by id.

### Error codes (`ErrorCode`)

- `-32700` — **Parse error**: Invalid JSON was received by the server. An error occurred on the server while parsing the JSON text.
- `-32600` — **Invalid request**: The JSON sent is not a valid Request object.
- `-32601` — **Method not found**: The method does not exist or is not available.
- `-32602` — **Invalid params**: Invalid method parameter(s).
- `-32603` — **Internal error**: Internal JSON-RPC error. Reserved for implementation-defined server errors.
- `-32800` — **Request cancelled**: Execution of the method was aborted either due to a cancellation request from the caller or because of resource constraints or shutdown.
- `-32000` — **Authentication required**: Authentication is required before this operation can be performed.
- `-32002` — **Resource not found**: A given resource, such as a file, was not found.
- `undefined` — Other undefined error code.

## 2. Data structures

All 265 definitions, in schema order. A `?` marks an optional field.

### RequestId
JSON RPC Request Id

- variant · null — The JSON-RPC `null` request id.
- variant · integer — A numeric JSON-RPC request id.
- variant · string — A string JSON-RPC request id.

### WriteTextFileRequest
Request to write content to a text file.

- `sessionId: SessionId` — The session ID for this request.
- `path: string` — Absolute path to the file to write.
- `content: string` — The text content to write to the file.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionId
A unique identifier for a conversation session between a client and agent.

- string

### ReadTextFileRequest
Request to read content from a text file.

- `sessionId: SessionId` — The session ID for this request.
- `path: string` — Absolute path to the file to read.
- `line?: integer|null` — Line number to start reading from (1-based).
- `limit?: integer|null` — Maximum number of lines to read.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### RequestPermissionRequest
Request for user permission to execute a tool call.

- `sessionId: SessionId` — The session ID for this request.
- `toolCall: ToolCallUpdate` — Details about the tool call requiring permission.
- `options: Array<PermissionOption>` — Available permission options for the user to choose from.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ToolCallUpdate
An update to an existing tool call.

- `toolCallId: ToolCallId` — The ID of the tool call being updated.
- `kind?: ToolKind | null` — Update the tool kind.
- `status?: ToolCallStatus | null` — Update the execution status.
- `title?: string|null` — Update the human-readable title.
- `name?: string|null` — **UNSTABLE**
- `content?: array|null` — Replace the content collection.
- `locations?: array|null` — Replace the locations collection.
- `rawInput?: any` — Update the raw input.
- `rawOutput?: any` — Update the raw output.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ToolCallId
Unique identifier for a tool call within a session.

- string

### ToolKind
Categories of tools that can be invoked.

- `"read"` — Reading files or data.
- `"edit"` — Modifying files or content.
- `"delete"` — Removing files or data.
- `"move"` — Moving or renaming files.
- `"search"` — Searching for information.
- `"execute"` — Running commands or code.
- `"think"` — Internal reasoning or planning.
- `"fetch"` — Retrieving external data.
- `"switch_mode"` — Switching the current session mode.
- `"other"` — Other tool types (default).

### ToolCallStatus
Execution status of a tool call.

- `"pending"` — The tool call hasn't started running yet because the input is either streaming or we're awaiting approval.
- `"in_progress"` — The tool call is currently running.
- `"completed"` — The tool call completed successfully.
- `"failed"` — The tool call failed with an error.

### ToolCallContent
Content produced by a tool call.

- `type: "content"` · Content — Standard content block (text, images, resources).
- `type: "diff"` · Diff — File modification shown as a diff.
- `type: "terminal"` · Terminal — Embed a terminal created with `terminal/create` by its id.

### ContentBlock
Content blocks represent displayable information in the Agent Client Protocol.

- `type: "text"` · TextContent — Text content. May be plain text or formatted with Markdown.
- `type: "image"` · ImageContent — Images for visual context or analysis.
- `type: "audio"` · AudioContent — Audio data for transcription or analysis.
- `type: "resource_link"` · ResourceLink — References to resources that the agent can access.
- `type: "resource"` · EmbeddedResource — Complete resource contents embedded directly in the message.

### Annotations
Optional annotations for the client. The client can use annotations to inform how objects are used or displayed

- `audience?: array|null` — Intended recipients for this content, such as the user or assistant.
- `lastModified?: string|null` — Timestamp indicating when the underlying resource was last modified.
- `priority?: number|null` — Relative importance of this content when clients choose what to surface.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### Role
The sender or recipient of messages and data in a conversation.

- `"assistant"` — The assistant side of a conversation.
- `"user"` — The user side of a conversation.

### TextContent
Text provided to or from an LLM.

- `annotations?: Annotations | null` — Optional annotations that help clients decide how to display or route this content.
- `text: string` — Text payload carried by this content block.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ImageContent
An image provided to or from an LLM.

- `annotations?: Annotations | null` — Optional annotations that help clients decide how to display or route this content.
- `data: string` — Base64-encoded media payload.
- `mimeType: string` — MIME type describing the encoded media payload.
- `uri?: string|null` — URI associated with this resource or media payload.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### AudioContent
Audio provided to or from an LLM.

- `annotations?: Annotations | null` — Optional annotations that help clients decide how to display or route this content.
- `data: string` — Base64-encoded media payload.
- `mimeType: string` — MIME type describing the encoded media payload.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ResourceLink
A resource that the server is capable of reading, included in a prompt or tool call result.

- `annotations?: Annotations | null` — Optional annotations that help clients decide how to display or route this content.
- `description?: string|null` — Optional human-readable details shown with this protocol object.
- `mimeType?: string|null` — MIME type describing the encoded media payload.
- `name: string` — Human-readable name shown for this protocol object.
- `size?: integer|null` — Optional size of the linked resource in bytes, if known.
- `title?: string|null` — Optional display title for end-user UI.
- `uri: string` — URI associated with this resource or media payload.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### EmbeddedResourceResource
Resource content that can be embedded in a message.

- variant · TextResourceContents — Text resource contents embedded directly in the message.
- variant · BlobResourceContents — Binary resource contents embedded directly in the message.

### TextResourceContents
Text-based resource contents.

- `mimeType?: string|null` — MIME type describing the encoded media payload.
- `text: string` — Text payload carried by this content block.
- `uri: string` — URI associated with this resource or media payload.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### BlobResourceContents
Binary resource contents.

- `blob: string` — Base64-encoded bytes for a binary resource payload.
- `mimeType?: string|null` — MIME type describing the encoded media payload.
- `uri: string` — URI associated with this resource or media payload.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### EmbeddedResource
The contents of a resource, embedded into a prompt or tool call result.

- `annotations?: Annotations | null` — Optional annotations that help clients decide how to display or route this content.
- `resource: EmbeddedResourceResource` — Embedded resource payload, either text or binary data.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### Content
Standard content block (text, images, resources).

- `content: ContentBlock` — The actual content block.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### Diff
A diff representing file modifications.

- `path: string` — The absolute file path being modified.
- `oldText?: string|null` — The original content (None for new files).
- `newText: string` — The new content after modification.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### TerminalId
Typed identifier used for terminal values on the wire.

- string

### Terminal
Embed a terminal created with `terminal/create` by its id.

- `terminalId: TerminalId` — Identifier of the terminal instance to embed in the content stream.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ToolCallLocation
A file location being accessed or modified by a tool.

- `path: string` — The absolute file path being accessed or modified.
- `line?: integer|null` — Optional line number within the file.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### PermissionOption
An option presented to the user when requesting permission.

- `optionId: PermissionOptionId` — Unique identifier for this permission option.
- `name: string` — Human-readable label to display to the user.
- `kind: PermissionOptionKind` — Hint about the nature of this permission option.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### PermissionOptionId
Unique identifier for a permission option.

- string

### PermissionOptionKind
The type of permission option being presented to the user.

- `"allow_once"` — Allow this operation only this time.
- `"allow_always"` — Allow this operation and remember the choice.
- `"reject_once"` — Reject this operation only this time.
- `"reject_always"` — Reject this operation and remember the choice.

### CreateTerminalRequest
Request to create a new terminal and execute a command.

- `sessionId: SessionId` — The session ID for this request.
- `command: string` — The command to execute.
- `args?: Array<string>` — Array of command arguments.
- `env?: Array<EnvVariable>` — Environment variables for the command.
- `cwd?: string|null` — Working directory for the command. Must be an absolute path.
- `outputByteLimit?: integer|null` — Maximum number of output bytes to retain.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### EnvVariable
An environment variable to set when launching an MCP server.

- `name: string` — The name of the environment variable.
- `value: string` — The value to set for the environment variable.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### TerminalOutputRequest
Request to get the current output and status of a terminal.

- `sessionId: SessionId` — The session ID for this request.
- `terminalId: TerminalId` — The ID of the terminal to get output from.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ReleaseTerminalRequest
Request to release a terminal and free its resources.

- `sessionId: SessionId` — The session ID for this request.
- `terminalId: TerminalId` — The ID of the terminal to release.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### WaitForTerminalExitRequest
Request to wait for a terminal command to exit.

- `sessionId: SessionId` — The session ID for this request.
- `terminalId: TerminalId` — The ID of the terminal to wait for.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### KillTerminalRequest
Request to kill a terminal without releasing it.

- `sessionId: SessionId` — The session ID for this request.
- `terminalId: TerminalId` — The ID of the terminal to kill.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### CreateElicitationRequest
Request from the agent to elicit structured user input.

- `mode: "form"` · ElicitationFormMode — Form-based elicitation where the client renders a form from the provided schema.
- `mode: "url"` · ElicitationUrlMode — URL-based elicitation where the client directs the user to a URL.
- variant · {...} — Custom or future elicitation mode.

### ElicitationSessionScope
Session-scoped elicitation, optionally tied to a specific tool call.

- `sessionId: SessionId` — The session this elicitation is tied to.
- `toolCallId?: ToolCallId | null` — Optional tool call within the session.

### ElicitationRequestScope
Request-scoped elicitation, tied to a specific JSON-RPC request outside of a session (e.g., during auth/configuration phases before any session is started).

- `requestId: RequestId` — The request this elicitation is tied to.

### ElicitationSchema
Type-safe elicitation schema for requesting structured user input.

- `type?: ElicitationSchemaType` default: "object" — Type discriminator. Always `"object"`.
- `title?: string|null` — Optional title for the schema.
- `properties?: Record<string, ElicitationPropertySchema>` default: {} — Property definitions (must be primitive types).
- `required?: array|null` — List of required property names.
- `description?: string|null` — Optional description of what this schema represents.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ElicitationSchemaType
Type discriminator for elicitation schemas.

- `"object"` — Object schema type.

### ElicitationPropertySchema
Property schema for elicitation form fields.

- `type: "string"` · StringPropertySchema — String property (or single-select enum when `enum`/`oneOf` is set).
- `type: "number"` · NumberPropertySchema — Number (floating-point) property.
- `type: "integer"` · IntegerPropertySchema — Integer property.
- `type: "boolean"` · BooleanPropertySchema — Boolean property.
- `type: "array"` · MultiSelectPropertySchema — Multi-select array property.
- variant · {...} — Custom or future elicitation property schema.

### StringFormat
String format types for string properties in elicitation schemas.

- `"email"` — Email address format.
- `"uri"` — URI format.
- `"date"` — Date format (YYYY-MM-DD).
- `"date-time"` — Date-time format (ISO 8601).

### EnumOption
A titled enum option with a const value, human-readable title, and optional description.

- `const: string` — The constant value for this option.
- `title: string` — Human-readable title for this option.
- `description?: string|null` — Human-readable description.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### StringPropertySchema
Schema for string properties in an elicitation form.

- `title?: string|null` — Optional title for the property.
- `description?: string|null` — Human-readable description.
- `minLength?: integer|null` — Minimum string length.
- `maxLength?: integer|null` — Maximum string length.
- `pattern?: string|null` — Pattern the string must match.
- `format?: StringFormat | null` — String format.
- `default?: string|null` — Default value.
- `enum?: array|null` — Enum values for untitled single-select enums. Optional. Omitted and `null` are equivalent and mean no untitled single-select choices are declared by `enum`.
- `oneOf?: array|null` — Titled enum options for titled single-select enums. Optional. Omitted and `null` are equivalent and mean no titled single-select choices are declared by `oneOf`.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NumberPropertySchema
Schema for number (floating-point) properties in an elicitation form.

- `title?: string|null` — Optional title for the property.
- `description?: string|null` — Human-readable description.
- `minimum?: number|null` — Minimum value (inclusive).
- `maximum?: number|null` — Maximum value (inclusive).
- `default?: number|null` — Default value.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### IntegerPropertySchema
Schema for integer properties in an elicitation form.

- `title?: string|null` — Optional title for the property.
- `description?: string|null` — Human-readable description.
- `minimum?: integer|null` — Minimum value (inclusive).
- `maximum?: integer|null` — Maximum value (inclusive).
- `default?: integer|null` — Default value.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### BooleanPropertySchema
Schema for boolean properties in an elicitation form.

- `title?: string|null` — Optional title for the property.
- `description?: string|null` — Human-readable description.
- `default?: boolean|null` — Default value.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### MultiSelectItems
Items for a multi-select (array) property schema.

- `type: "string"` · StringMultiSelectItems — Multi-select string items with plain string values.
- variant · {...} — Custom or future typed multi-select items.
- variant · TitledMultiSelectItems — Titled multi-select items with human-readable labels.

### StringMultiSelectItems
String item schema for multi-select enum properties.

- `enum: Array<string>` — Allowed enum values.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### TitledMultiSelectItems
Items definition for titled multi-select enum properties.

- `anyOf: Array<EnumOption>` — Titled enum options.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### MultiSelectPropertySchema
Schema for multi-select (array) properties in an elicitation form.

- `title?: string|null` — Optional title for the property.
- `description?: string|null` — Human-readable description.
- `minItems?: integer|null` — Minimum number of items to select.
- `maxItems?: integer|null` — Maximum number of items to select.
- `items: MultiSelectItems` — The items definition describing allowed values.
- `default?: array|null` — Default selected values.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ElicitationFormMode
Form-based elicitation mode where the client renders a form from the provided schema.

- variant · ElicitationSessionScope — Tied to a session, optionally to a specific tool call within that session.
- variant · ElicitationRequestScope — Tied to a specific JSON-RPC request outside of a session (e.g., during auth/configuration phases before any session is started).

### ElicitationId
Unique identifier for an elicitation.

- string

### ElicitationUrlMode
URL-based elicitation mode where the client directs the user to a URL.

- variant · ElicitationSessionScope — Tied to a session, optionally to a specific tool call within that session.
- variant · ElicitationRequestScope — Tied to a specific JSON-RPC request outside of a session (e.g., during auth/configuration phases before any session is started).

### ConnectMcpRequest
**UNSTABLE**
> UNSTABLE / experimental area.

- `serverId: McpServerAcpId` — The ACP MCP server ID that was provided by the component declaring the MCP server.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### McpServerAcpId
**UNSTABLE**
> UNSTABLE / experimental area.

- string

### MessageMcpRequest
**UNSTABLE**
> UNSTABLE / experimental area.

- `connectionId: McpConnectionId` — The MCP-over-ACP connection this message is sent on.
- `method: string` — The inner MCP method name.
- `params?: object|null` — Optional inner MCP params.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### McpConnectionId
**UNSTABLE**
> UNSTABLE / experimental area.

- string

### DisconnectMcpRequest
**UNSTABLE**
> UNSTABLE / experimental area.

- `connectionId: McpConnectionId` — The MCP-over-ACP connection to close.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ExtRequest
Allows for sending an arbitrary request that is not part of the ACP spec. Extension methods provide a way to add custom functionality while maintaining protocol compatibility.

- any

### InitializeResponse
Response to the `initialize` method.

- `protocolVersion: ProtocolVersion` — The protocol version the client specified if supported by the agent, or the latest protocol version supported by the agent.
- `agentCapabilities?: AgentCapabilities` default: {"loadSession":false,"promptCapabilities":{"image":false,"audio":false,"embeddedContext":false},"mcpCapabilities":{"http":false,"sse":false,"acp":false},"sessionCapabilities":{},"auth":{}} — Capabilities supported by the agent.
- `authMethods?: Array<AuthMethod>` default: [] — Authentication methods supported by the agent.
- `agentInfo?: Implementation | null` — Information about the Agent name and version sent to the Client.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ProtocolVersion
Protocol version identifier.

- integer

### AgentCapabilities
Capabilities supported by the agent.

- `loadSession?: boolean` default: false — Whether the agent supports `session/load`.
- `promptCapabilities?: PromptCapabilities` default: {"image":false,"audio":false,"embeddedContext":false} — Prompt capabilities supported by the agent.
- `mcpCapabilities?: McpCapabilities` default: {"http":false,"sse":false,"acp":false} — MCP capabilities supported by the agent.
- `sessionCapabilities?: SessionCapabilities` default: {} — Session lifecycle and prompt capabilities advertised by the agent.
- `auth?: AgentAuthCapabilities` default: {} — Authentication-related capabilities supported by the agent.
- `providers?: ProvidersCapabilities | null` — **UNSTABLE**
- `nes?: NesCapabilities | null` — **UNSTABLE**
- `positionEncoding?: PositionEncodingKind | null` — **UNSTABLE**
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### PromptCapabilities
Prompt capabilities supported by the agent in `session/prompt` requests.

- `image?: boolean` default: false — Agent supports [`ContentBlock::Image`].
- `audio?: boolean` default: false — Agent supports [`ContentBlock::Audio`].
- `embeddedContext?: boolean` default: false — Agent supports embedded context in `session/prompt` requests.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### McpCapabilities
MCP capabilities supported by the agent

- `http?: boolean` default: false — Agent supports [`McpServer::Http`].
- `sse?: boolean` default: false — Agent supports [`McpServer::Sse`].
- `acp?: boolean` default: false — **UNSTABLE**
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionCapabilities
Session capabilities supported by the agent.

- `list?: SessionListCapabilities | null` — Whether the agent supports `session/list`.
- `delete?: SessionDeleteCapabilities | null` — Whether the agent supports `session/delete`.
- `additionalDirectories?: SessionAdditionalDirectoriesCapabilities | null` — Whether the agent supports `additionalDirectories` on supported session lifecycle requests.
- `fork?: SessionForkCapabilities | null` — **UNSTABLE**
- `resume?: SessionResumeCapabilities | null` — Whether the agent supports `session/resume`.
- `close?: SessionCloseCapabilities | null` — Whether the agent supports `session/close`.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionListCapabilities
Capabilities for the `session/list` method.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionDeleteCapabilities
Capabilities for the `session/delete` method.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionAdditionalDirectoriesCapabilities
Capabilities for additional session directories support.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionForkCapabilities
**UNSTABLE**
> UNSTABLE / experimental area.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionResumeCapabilities
Capabilities for the `session/resume` method.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionCloseCapabilities
Capabilities for the `session/close` method.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### AgentAuthCapabilities
Authentication-related capabilities supported by the agent.

- `logout?: LogoutCapabilities | null` — Whether the agent supports the logout method.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### LogoutCapabilities
Logout capabilities supported by the agent.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ProvidersCapabilities
**UNSTABLE**
> UNSTABLE / experimental area.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesCapabilities
NES capabilities advertised by the agent during initialization.

- `events?: NesEventCapabilities | null` — Events the agent wants to receive.
- `context?: NesContextCapabilities | null` — Context the agent wants attached to each suggestion request.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesEventCapabilities
Event capabilities the agent can consume.

- `document?: NesDocumentEventCapabilities | null` — Document event capabilities.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesDocumentEventCapabilities
Document event capabilities the agent wants to receive.

- `didOpen?: NesDocumentDidOpenCapabilities | null` — Whether the agent wants `document/didOpen` events.
- `didChange?: NesDocumentDidChangeCapabilities | null` — Whether the agent wants `document/didChange` events, and the sync kind.
- `didClose?: NesDocumentDidCloseCapabilities | null` — Whether the agent wants `document/didClose` events.
- `didSave?: NesDocumentDidSaveCapabilities | null` — Whether the agent wants `document/didSave` events.
- `didFocus?: NesDocumentDidFocusCapabilities | null` — Whether the agent wants `document/didFocus` events.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesDocumentDidOpenCapabilities
Marker for `document/didOpen` capability support.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesDocumentDidChangeCapabilities
Capabilities for `document/didChange` events.

- `syncKind: TextDocumentSyncKind` — The sync kind the agent wants: `"full"` or `"incremental"`.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### TextDocumentSyncKind
How the agent wants document changes delivered.

- `"full"` — Client sends the entire file content on each change.
- `"incremental"` — Client sends only the changed ranges.

### NesDocumentDidCloseCapabilities
Marker for `document/didClose` capability support.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesDocumentDidSaveCapabilities
Marker for `document/didSave` capability support.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesDocumentDidFocusCapabilities
Marker for `document/didFocus` capability support.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesContextCapabilities
Context capabilities the agent wants attached to each suggestion request.

- `recentFiles?: NesRecentFilesCapabilities | null` — Whether the agent wants recent files context.
- `relatedSnippets?: NesRelatedSnippetsCapabilities | null` — Whether the agent wants related snippets context.
- `editHistory?: NesEditHistoryCapabilities | null` — Whether the agent wants edit history context.
- `userActions?: NesUserActionsCapabilities | null` — Whether the agent wants user actions context.
- `openFiles?: NesOpenFilesCapabilities | null` — Whether the agent wants open files context.
- `diagnostics?: NesDiagnosticsCapabilities | null` — Whether the agent wants diagnostics context.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesRecentFilesCapabilities
Capabilities for recent files context.

- `maxCount?: integer|null` — Maximum number of recent files the agent can use.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesRelatedSnippetsCapabilities
Capabilities for related snippets context.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesEditHistoryCapabilities
Capabilities for edit history context.

- `maxCount?: integer|null` — Maximum number of edit history entries the agent can use.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesUserActionsCapabilities
Capabilities for user actions context.

- `maxCount?: integer|null` — Maximum number of user actions the agent can use.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesOpenFilesCapabilities
Capabilities for open files context.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesDiagnosticsCapabilities
Capabilities for diagnostics context.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### PositionEncodingKind
The encoding used for character offsets in positions.

- `"utf-16"` — Character offsets count UTF-16 code units. This is the default.
- `"utf-32"` — Character offsets count Unicode code points.
- `"utf-8"` — Character offsets count UTF-8 code units (bytes).

### AuthMethod
Describes an available authentication method.

- `type: "terminal"` · AuthMethodTerminal — Client runs the configured agent program as a separate interactive process, without passing this method to `authenticate`.
- variant · AuthMethodAgent — Agent handles authentication itself through `authenticate`.

### AuthMethodId
Typed identifier used for auth method values on the wire.

- string

### AuthMethodTerminal
Terminal-based authentication method.

- `id: AuthMethodId` — Unique identifier for this authentication method.
- `name: string` — Human-readable name of the authentication method.
- `description?: string|null` — Optional description providing more details about this authentication method.
- `args?: Array<string>` — Additional arguments to append to the configured agent invocation for terminal auth.
- `env?: Record<string, string>` — Additional environment variables to set on the configured agent invocation for terminal auth. These values override same-named variables in the base launch configuration.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### AuthMethodAgent
Agent handles authentication itself through `authenticate`.

- `id: AuthMethodId` — Unique identifier for this authentication method.
- `name: string` — Human-readable name of the authentication method.
- `description?: string|null` — Optional description providing more details about this authentication method.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### Implementation
Metadata about the implementation of the client or agent. Describes the name and version of an ACP implementation, with an optional title for UI representation.

- `name: string` — Intended for programmatic or logical use, but can be used as a display name fallback if title isn’t present.
- `title?: string|null` — Intended for UI and end-user contexts — optimized to be human-readable and easily understood.
- `version: string` — Version of the implementation. Can be displayed to the user or used for debugging or metrics purposes. (e.g. "1.0.0").
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### AuthenticateResponse
Response to the `authenticate` method.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ListProvidersResponse
**UNSTABLE**
> UNSTABLE / experimental area.

- `providers: Array<ProviderInfo>` — Configurable providers with current routing info suitable for UI display.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ProviderInfo
**UNSTABLE**
> UNSTABLE / experimental area.

- `providerId: ProviderId` — Provider identifier, for example "main" or "openai".
- `supported: Array<LlmProtocol>` — Supported protocol types for this provider.
- `required: boolean` — Whether this provider is mandatory and cannot be disabled via `providers/disable`. If true, clients must not call `providers/disable` for this provider ID.
- `current?: ProviderCurrentConfig | null` — Current effective non-secret routing config. Null or omitted means provider is disabled.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ProviderId
**UNSTABLE**
> UNSTABLE / experimental area.

- string

### LlmProtocol
**UNSTABLE**
> UNSTABLE / experimental area.

- `"anthropic"` — Anthropic API protocol.
- `"openai"` — OpenAI API protocol.
- `"azure"` — Azure OpenAI API protocol.
- `"vertex"` — Google Vertex AI API protocol.
- `"bedrock"` — AWS Bedrock API protocol.
- variant · string — Unknown or custom protocol.

### ProviderCurrentConfig
**UNSTABLE**
> UNSTABLE / experimental area.

- `apiType: LlmProtocol` — Protocol currently used by this provider.
- `baseUrl: string` — Base URL currently used by this provider.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SetProviderResponse
**UNSTABLE**
> UNSTABLE / experimental area.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### DisableProviderResponse
**UNSTABLE**
> UNSTABLE / experimental area.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### LogoutResponse
Response to the `logout` method.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NewSessionResponse
Response from creating a new session.

- `sessionId: SessionId` — Unique identifier for the created session.
- `modes?: SessionModeState | null` — Initial mode state if supported by the Agent
- `configOptions?: array|null` — Initial session configuration options if supported by the Agent.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionModeState
The set of modes and the one currently active.

- `currentModeId: SessionModeId` — The current mode the Agent is in.
- `availableModes: Array<SessionMode>` — The set of modes that the Agent can operate in
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionModeId
Unique identifier for a Session Mode.

- string

### SessionMode
A mode the agent can operate in.

- `id: SessionModeId` — Stable identifier used to refer to this protocol object in later messages.
- `name: string` — Human-readable name shown for this protocol object.
- `description?: string|null` — Optional human-readable details shown with this protocol object.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionConfigOption
A session configuration option selector and its current state.

- `type: "select"` · SessionConfigSelect — Single-value selector (dropdown).
- `type: "boolean"` · SessionConfigBoolean — Boolean on/off toggle.

### SessionConfigId
Unique identifier for a session configuration option.

- string

### SessionConfigOptionCategory
Semantic category for a session configuration option.

- `"mode"` — Session mode selector.
- `"model"` — Model selector.
- `"model_config"` — Model-related configuration parameter.
- `"thought_level"` — Thought/reasoning level selector.
- variant · string — Unknown / uncategorized selector.

### SessionConfigValueId
Unique identifier for a session configuration option value.

- string

### SessionConfigSelectOptions
Possible values for a session configuration option.

- variant · Array<SessionConfigSelectOption> — A flat list of options with no grouping.
- variant · Array<SessionConfigSelectGroup> — A list of options grouped under headers.

### SessionConfigSelectOption
A possible value for a session configuration option.

- `value: SessionConfigValueId` — Unique identifier for this option value.
- `name: string` — Human-readable label for this option value.
- `description?: string|null` — Optional description for this option value.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionConfigSelectGroup
A group of possible values for a session configuration option.

- `group: SessionConfigGroupId` — Unique identifier for this group.
- `name: string` — Human-readable label for this group.
- `options: Array<SessionConfigSelectOption>` — The set of option values in this group.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionConfigGroupId
Unique identifier for a session configuration option value group.

- string

### SessionConfigSelect
A single-value selector (dropdown) session configuration option payload.

- `currentValue: SessionConfigValueId` — The currently selected value.
- `options: SessionConfigSelectOptions` — The set of selectable options.

### SessionConfigBoolean
A boolean on/off toggle session configuration option payload.

- `currentValue: boolean` — The current value of the boolean option.

### LoadSessionResponse
Response from loading an existing session.

- `modes?: SessionModeState | null` — Initial mode state if supported by the Agent
- `configOptions?: array|null` — Initial session configuration options if supported by the Agent.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ListSessionsResponse
Response from listing sessions.

- `sessions: Array<SessionInfo>` — Array of session information objects
- `nextCursor?: string|null` — Opaque cursor token. If present, pass this in the next request's cursor parameter to fetch the next page. If absent, there are no more results.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionInfo
Information about a session returned by session/list

- `sessionId: SessionId` — Unique identifier for the session
- `cwd: string` — The working directory for this session. Must be an absolute path.
- `additionalDirectories?: Array<string>` — Additional workspace roots reported for this session. Each path must be absolute.
- `title?: string|null` — Human-readable title for the session
- `updatedAt?: string|null` — ISO 8601 timestamp of last activity
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### DeleteSessionResponse
Response from deleting a session.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ForkSessionResponse
**UNSTABLE**
> UNSTABLE / experimental area.

- `sessionId: SessionId` — Unique identifier for the newly created forked session.
- `modes?: SessionModeState | null` — Initial mode state if supported by the Agent
- `configOptions?: array|null` — Initial session configuration options if supported by the Agent.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ResumeSessionResponse
Response from resuming an existing session.

- `modes?: SessionModeState | null` — Initial mode state if supported by the Agent
- `configOptions?: array|null` — Initial session configuration options if supported by the Agent.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### CloseSessionResponse
Response from closing a session.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SetSessionModeResponse
Response to `session/set_mode` method.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SetSessionConfigOptionResponse
Response to `session/set_config_option` method.

- `configOptions: Array<SessionConfigOption>` — The full set of configuration options and their current values.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### PromptResponse
Response from processing a user prompt.

- `stopReason: StopReason` — Indicates why the agent stopped processing the turn.
- `usage?: Usage | null` — **UNSTABLE**
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### StopReason
Reasons why an agent stops processing a prompt turn.

- `"end_turn"` — The turn ended successfully.
- `"max_tokens"` — The turn ended because the agent reached the maximum number of tokens.
- `"max_turn_requests"` — The turn ended because the agent reached the maximum number of allowed agent requests between user turns.
- `"refusal"` — The turn ended because the agent refused to continue. The user prompt and everything that comes after it won't be included in the next prompt, so this should be reflected in the UI.
- `"cancelled"` — The turn was cancelled by the client via `session/cancel`.

### Usage
**UNSTABLE**
> UNSTABLE / experimental area.

- `totalTokens: integer` — Sum of all token types across session.
- `inputTokens: integer` — Total input tokens across all turns.
- `outputTokens: integer` — Total output tokens across all turns.
- `thoughtTokens?: integer|null` — Total thought/reasoning tokens
- `cachedReadTokens?: integer|null` — Total cache read tokens.
- `cachedWriteTokens?: integer|null` — Total cache write tokens.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### StartNesResponse
Response to `nes/start`.

- `sessionId: SessionId` — The session ID for the newly started NES session.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SuggestNesResponse
Response to `nes/suggest`.

- `suggestions: Array<NesSuggestion>` — The list of suggestions.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesSuggestion
A suggestion returned by the agent.

- `kind: "edit"` · NesEditSuggestion — A text edit suggestion.
- `kind: "jump"` · NesJumpSuggestion — A jump-to-location suggestion.
- `kind: "rename"` · NesRenameSuggestion — A rename symbol suggestion.
- `kind: "searchAndReplace"` · NesSearchAndReplaceSuggestion — A search-and-replace suggestion.

### NesSuggestionId
Unique identifier for a next edit suggestion.

- string

### NesTextEdit
A text edit within a suggestion.

- `range: Range` — The range to replace.
- `newText: string` — The replacement text.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### Range
A range in a text document, expressed as start and end positions.

- `start: Position` — The start position (inclusive).
- `end: Position` — The end position (exclusive).
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### Position
A zero-based position in a text document.

- `line: integer` — Zero-based line number.
- `character: integer` — Zero-based character offset (encoding-dependent).
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesEditSuggestion
A text edit suggestion.

- `id: NesSuggestionId` — Unique identifier for accept/reject tracking.
- `uri: string` — The URI of the file to edit.
- `edits: Array<NesTextEdit>` — The text edits to apply.
- `cursorPosition?: Position | null` — Optional suggested cursor position after applying edits.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesJumpSuggestion
A jump-to-location suggestion.

- `id: NesSuggestionId` — Unique identifier for accept/reject tracking.
- `uri: string` — The file to navigate to.
- `position: Position` — The target position within the file.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesRenameSuggestion
A rename symbol suggestion.

- `id: NesSuggestionId` — Unique identifier for accept/reject tracking.
- `uri: string` — The file URI containing the symbol.
- `position: Position` — The position of the symbol to rename.
- `newName: string` — The new name for the symbol.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesSearchAndReplaceSuggestion
A search-and-replace suggestion.

- `id: NesSuggestionId` — Unique identifier for accept/reject tracking.
- `uri: string` — The file URI to search within.
- `search: string` — The text or pattern to find.
- `replace: string` — The replacement text.
- `isRegex?: boolean|null` — Whether `search` is a regular expression. Defaults to `false`.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### CloseNesResponse
Response from closing an NES session.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ExtResponse
Allows for sending an arbitrary response to an [`ExtRequest`] that is not part of the ACP spec. Extension methods provide a way to add custom functionality while maintaining protocol compatibility.

- any

### MessageMcpResponse
**UNSTABLE**
> UNSTABLE / experimental area.

- any

### Error
JSON-RPC error object.

- `code: ErrorCode` — A number indicating the error type that occurred. This must be an integer as defined in the JSON-RPC specification.
- `message: string` — A string providing a short description of the error. The message should be limited to a concise single sentence.
- `data?: any` — Optional primitive or structured value that contains additional information about the error. This may include debugging information or context-specific details.

### ErrorCode
Predefined error codes for common JSON-RPC and ACP-specific errors.

- `-32700` — **Parse error**: Invalid JSON was received by the server. An error occurred on the server while parsing the JSON text.
- `-32600` — **Invalid request**: The JSON sent is not a valid Request object.
- `-32601` — **Method not found**: The method does not exist or is not available.
- `-32602` — **Invalid params**: Invalid method parameter(s).
- `-32603` — **Internal error**: Internal JSON-RPC error. Reserved for implementation-defined server errors.
- `-32800` — **Request cancelled**: Execution of the method was aborted either due to a cancellation request from the caller or because of resource constraints or shutdown.
- `-32000` — **Authentication required**: Authentication is required before this operation can be performed.
- `-32002` — **Resource not found**: A given resource, such as a file, was not found.
- variant · integer — Other undefined error code.

### SessionNotification
Notification containing a session update from the agent.

- `sessionId: SessionId` — The ID of the session this update pertains to.
- `update: SessionUpdate` — The actual update content.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionUpdate
Different types of updates that can be sent during session processing.

- `sessionUpdate: "user_message_chunk"` · ContentChunk — A chunk of the user's message being streamed.
- `sessionUpdate: "agent_message_chunk"` · ContentChunk — A chunk of the agent's response being streamed.
- `sessionUpdate: "agent_thought_chunk"` · ContentChunk — A chunk of the agent's internal reasoning being streamed.
- `sessionUpdate: "tool_call"` · ToolCall — Notification that a new tool call has been initiated.
- `sessionUpdate: "tool_call_update"` · ToolCallUpdate — Update on the status or results of a tool call.
- `sessionUpdate: "plan"` · Plan — The agent's execution plan for complex tasks.
- `sessionUpdate: "plan_update"` · PlanUpdate — **UNSTABLE**
- `sessionUpdate: "plan_removed"` · PlanRemoved — **UNSTABLE**
- `sessionUpdate: "available_commands_update"` · AvailableCommandsUpdate — Available commands are ready or have changed
- `sessionUpdate: "current_mode_update"` · CurrentModeUpdate — The current mode of the session has changed
- `sessionUpdate: "config_option_update"` · ConfigOptionUpdate — Session configuration options have been updated.
- `sessionUpdate: "session_info_update"` · SessionInfoUpdate — Session metadata has been updated (title, timestamps, custom metadata)
- `sessionUpdate: "usage_update"` · UsageUpdate — Context window and cost update for the session.
- `sessionUpdate: "compaction_update"` · CompactionUpdate — **UNSTABLE**
- `sessionUpdate: "compaction_summary_chunk"` · CompactionSummaryChunk — **UNSTABLE**

### MessageId
Unique identifier for a message within a session.

- string

### ContentChunk
A streamed item of content

- `content: ContentBlock` — A single item of content
- `messageId?: MessageId | null` — A unique identifier for the message this chunk belongs to.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ToolCall
Represents a tool call that the language model has requested.

- `toolCallId: ToolCallId` — Unique identifier for this tool call within the session.
- `title: string` — Human-readable title describing what the tool is doing.
- `name?: string|null` — **UNSTABLE**
- `kind?: ToolKind` — The category of tool being invoked. Helps clients choose appropriate icons and UI treatment.
- `status?: ToolCallStatus` — Current execution status of the tool call.
- `content?: Array<ToolCallContent>` — Content produced by the tool call.
- `locations?: Array<ToolCallLocation>` — File locations affected by this tool call. Enables "follow-along" features in clients.
- `rawInput?: any` — Raw input parameters sent to the tool.
- `rawOutput?: any` — Raw output returned by the tool.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### PlanEntry
A single entry in the execution plan.

- `content: string` — Human-readable description of what this task aims to accomplish.
- `priority: PlanEntryPriority` — The relative importance of this task. Used to indicate which tasks are most critical to the overall goal.
- `status: PlanEntryStatus` — Current execution status of this task.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### PlanEntryPriority
Priority levels for plan entries.

- `"high"` — High priority task - critical to the overall goal.
- `"medium"` — Medium priority task - important but not critical.
- `"low"` — Low priority task - nice to have but not essential.

### PlanEntryStatus
Status of a plan entry in the execution flow.

- `"pending"` — The task has not started yet.
- `"in_progress"` — The task is currently being worked on.
- `"completed"` — The task has been successfully completed.

### Plan
An execution plan for accomplishing complex tasks.

- `entries: Array<PlanEntry>` — The list of tasks to be accomplished.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### PlanUpdateContent
**UNSTABLE**
> UNSTABLE / experimental area.

- `type: "items"` · PlanItems — Structured plan entries.
- `type: "file"` · PlanFile — A URI pointing to a file containing the plan.
- `type: "markdown"` · PlanMarkdown — Raw markdown content for the plan.

### PlanId
**UNSTABLE**
> UNSTABLE / experimental area.

- string

### PlanItems
**UNSTABLE**
> UNSTABLE / experimental area.

- `planId: PlanId` — The plan ID to update.
- `entries: Array<PlanEntry>` — The list of tasks to be accomplished.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### PlanFile
**UNSTABLE**
> UNSTABLE / experimental area.

- `planId: PlanId` — The plan ID to update.
- `uri: string` — The URI of the file containing the plan.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### PlanMarkdown
**UNSTABLE**
> UNSTABLE / experimental area.

- `planId: PlanId` — The plan ID to update.
- `content: string` — Markdown content for the plan.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### PlanUpdate
**UNSTABLE**
> UNSTABLE / experimental area.

- `plan: PlanUpdateContent` — The updated plan content.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### PlanRemoved
**UNSTABLE**
> UNSTABLE / experimental area.

- `planId: PlanId` — The plan ID to remove.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### AvailableCommand
Information about a command.

- `name: string` — Command name (e.g., `create_plan`, `research_codebase`).
- `description: string` — Human-readable description of what the command does.
- `input?: AvailableCommandInput | null` — Input for the command if required
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### AvailableCommandInput
The input specification for a command.

- variant · UnstructuredCommandInput — All text that was typed after the command name is provided as input.

### UnstructuredCommandInput
All text that was typed after the command name is provided as input.

- `hint: string` — A hint to display when the input hasn't been provided yet
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### AvailableCommandsUpdate
Available commands are ready or have changed

- `availableCommands: Array<AvailableCommand>` — Commands the agent can execute
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### CurrentModeUpdate
The current mode of the session has changed

- `currentModeId: SessionModeId` — The ID of the current mode
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ConfigOptionUpdate
Session configuration options have been updated.

- `configOptions: Array<SessionConfigOption>` — The full set of configuration options and their current values.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SessionInfoUpdate
Update to session metadata. All fields are optional to support partial updates.

- `title?: string|null` — Human-readable title for the session. Set to null to clear.
- `updatedAt?: string|null` — ISO 8601 timestamp of last activity. Set to null to clear.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### Cost
Cost information for a session.

- `amount: number` — Total cumulative cost for session.
- `currency: string` — ISO 4217 currency code (e.g., "USD", "EUR").
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### UsageUpdate
Context window and cost update for a session.

- `used: integer` — Tokens currently in context.
- `size: integer` — Total context window size in tokens.
- `cost?: Cost | null` — Cumulative session cost (optional).
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### CompactionId
**UNSTABLE**
> UNSTABLE / experimental area.

- string

### CompactionStatus
**UNSTABLE**
> UNSTABLE / experimental area.

- `"in_progress"` — Compaction has started and has not finished.
- `"completed"` — Compaction finished successfully.
- `"failed"` — Compaction finished unsuccessfully.
- `"cancelled"` — Compaction was cancelled before it finished.
- variant · string — Custom or future compaction status.

### CompactionUpdate
**UNSTABLE**
> UNSTABLE / experimental area.

- `compactionId: CompactionId` — The Agent-owned ID of this compaction, unique within the session.
- `status: CompactionStatus` — Current lifecycle status.
- `summary?: array|null` — Complete replacement user-displayable summary retained by the compaction.
- `error?: string|null` — Human-readable description of why the compaction failed.
- `_meta?: object|null` — Extensible metadata patch for this compaction.

### CompactionSummaryChunk
**UNSTABLE**
> UNSTABLE / experimental area.

- `compactionId: CompactionId` — ID of the compaction whose summary receives this content.
- `content: ContentBlock` — One content block to append.
- `_meta?: object|null` — Metadata scoped to this chunk. Omission and `null` both mean absent.

### CompleteElicitationNotification
Notification sent by the agent when a URL-based elicitation is complete.

- `elicitationId: ElicitationId` — The ID of the elicitation that completed.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### MessageMcpNotification
**UNSTABLE**
> UNSTABLE / experimental area.

- `connectionId: McpConnectionId` — The MCP-over-ACP connection this message is sent on.
- `method: string` — The inner MCP method name.
- `params?: object|null` — Optional inner MCP params.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ExtNotification
Allows the Agent to send an arbitrary notification that is not part of the ACP spec. Extension notifications provide a way to send one-way messages for custom functionality while maintaining protocol compatibility.

- any

### InitializeRequest
Request parameters for the initialize method.

- `protocolVersion: ProtocolVersion` — The latest protocol version supported by the client.
- `clientCapabilities?: ClientCapabilities` default: {"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false,"auth":{"terminal":false}} — Capabilities supported by the client.
- `clientInfo?: Implementation | null` — Information about the Client name and version sent to the Agent.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ClientCapabilities
Capabilities supported by the client.

- `fs?: FileSystemCapabilities` default: {"readTextFile":false,"writeTextFile":false} — File system capabilities supported by the client. Determines which file operations the agent can request.
- `terminal?: boolean` default: false — Whether the Client support all `terminal/*` methods.
- `session?: ClientSessionCapabilities | null` — Session-related capabilities supported by the client.
- `plan?: PlanCapabilities | null` — **UNSTABLE**
- `auth?: AuthCapabilities` default: {"terminal":false} — Authentication capabilities supported by the client. Determines which authentication method types the agent may include in its `InitializeResponse`.
- `elicitation?: ElicitationCapabilities | null` — Elicitation capabilities supported by the client. Determines which elicitation modes the agent may use.
- `nes?: ClientNesCapabilities | null` — **UNSTABLE**
- `positionEncodings?: Array<PositionEncodingKind>` — **UNSTABLE**
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### FileSystemCapabilities
File system capabilities that a client may support.

- `readTextFile?: boolean` default: false — Whether the Client supports `fs/read_text_file` requests.
- `writeTextFile?: boolean` default: false — Whether the Client supports `fs/write_text_file` requests.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ClientSessionCapabilities
Session-related capabilities supported by the client.

- `compaction?: CompactionCapabilities | null` — **UNSTABLE**
- `configOptions?: SessionConfigOptionsCapabilities | null` — Config option capabilities supported by the client.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### CompactionCapabilities
**UNSTABLE**
> UNSTABLE / experimental area.

- object

### SessionConfigOptionsCapabilities
Session configuration option capabilities supported by the client.

- `boolean?: BooleanConfigOptionCapabilities | null` — Whether the client supports boolean session configuration options.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### BooleanConfigOptionCapabilities
Capabilities for boolean session configuration options.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### PlanCapabilities
**UNSTABLE**
> UNSTABLE / experimental area.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### AuthCapabilities
Authentication capabilities supported by the client.

- `terminal?: boolean` default: false — Whether the client supports `terminal` authentication methods.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ElicitationCapabilities
Elicitation capabilities supported by the client.

- `form?: ElicitationFormCapabilities | null` — Whether the client supports form-based elicitation.
- `url?: ElicitationUrlCapabilities | null` — Whether the client supports URL-based elicitation.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ElicitationFormCapabilities
Form-based elicitation capabilities.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ElicitationUrlCapabilities
URL-based elicitation capabilities.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ClientNesCapabilities
NES capabilities advertised by the client during initialization.

- `jump?: NesJumpCapabilities | null` — Whether the client supports the `jump` suggestion kind.
- `rename?: NesRenameCapabilities | null` — Whether the client supports the `rename` suggestion kind.
- `searchAndReplace?: NesSearchAndReplaceCapabilities | null` — Whether the client supports the `searchAndReplace` suggestion kind.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesJumpCapabilities
Marker for jump suggestion support.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesRenameCapabilities
Marker for rename suggestion support.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesSearchAndReplaceCapabilities
Marker for search and replace suggestion support.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### AuthenticateRequest
Request parameters for the authenticate method.

- `methodId: AuthMethodId` — The ID of the authentication method to use. Must be one of the methods advertised in the initialize response.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ListProvidersRequest
**UNSTABLE**
> UNSTABLE / experimental area.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SetProviderRequest
**UNSTABLE**
> UNSTABLE / experimental area.

- `providerId: ProviderId` — Provider ID to configure.
- `apiType: LlmProtocol` — Protocol type for this provider.
- `baseUrl: string` — Base URL for requests sent through this provider.
- `headers?: Record<string, string>` — Full headers map for this provider. May include authorization, routing, or other integration-specific headers.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### DisableProviderRequest
**UNSTABLE**
> UNSTABLE / experimental area.

- `providerId: ProviderId` — Provider ID to disable.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### LogoutRequest
Request parameters for the logout method.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NewSessionRequest
Request parameters for creating a new session.

- `cwd: string` — The working directory for this session. Must be an absolute path.
- `additionalDirectories?: Array<string>` — Additional workspace roots for this session. Each path must be absolute.
- `mcpServers: Array<McpServer>` — List of MCP (Model Context Protocol) servers the agent should connect to.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### McpServer
Configuration for connecting to an MCP (Model Context Protocol) server.

- `type: "http"` · McpServerHttp — HTTP transport configuration
- `type: "sse"` · McpServerSse — SSE transport configuration
- `type: "acp"` · McpServerAcp — **UNSTABLE**
- variant · McpServerStdio — Stdio transport configuration

### HttpHeader
An HTTP header to set when making requests to the MCP server.

- `name: string` — The name of the HTTP header.
- `value: string` — The value to set for the HTTP header.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### McpServerHttp
HTTP transport configuration for MCP.

- `name: string` — Human-readable name identifying this MCP server.
- `url: string` — URL to the MCP server.
- `headers: Array<HttpHeader>` — HTTP headers to set when making requests to the MCP server.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### McpServerSse
SSE transport configuration for MCP.

- `name: string` — Human-readable name identifying this MCP server.
- `url: string` — URL to the MCP server.
- `headers: Array<HttpHeader>` — HTTP headers to set when making requests to the MCP server.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### McpServerAcp
**UNSTABLE**
> UNSTABLE / experimental area.

- `name: string` — Human-readable name identifying this MCP server.
- `serverId: McpServerAcpId` — Unique identifier for this MCP server, generated by the component providing it.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### McpServerStdio
Stdio transport configuration for MCP.

- `name: string` — Human-readable name identifying this MCP server.
- `command: string` — Absolute path to the MCP server executable.
- `args: Array<string>` — Command-line arguments to pass to the MCP server.
- `env: Array<EnvVariable>` — Environment variables to set when launching the MCP server.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### LoadSessionRequest
Request parameters for loading an existing session.

- `mcpServers: Array<McpServer>` — List of MCP servers to connect to for this session.
- `cwd: string` — The working directory for this session. Must be an absolute path.
- `additionalDirectories?: Array<string>` — Additional workspace roots to activate for this session. Each path must be absolute.
- `sessionId: SessionId` — The ID of the session to load.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ListSessionsRequest
Request parameters for listing existing sessions.

- `cwd?: string|null` — Filter sessions by working directory. Must be an absolute path.
- `cursor?: string|null` — Opaque cursor token from a previous response's nextCursor field for cursor-based pagination
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### DeleteSessionRequest
Request parameters for deleting an existing session from `session/list`.

- `sessionId: SessionId` — The ID of the session to delete.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ForkSessionRequest
**UNSTABLE**
> UNSTABLE / experimental area.

- `sessionId: SessionId` — The ID of the session to fork.
- `cwd: string` — The working directory for this session. Must be an absolute path.
- `additionalDirectories?: Array<string>` — Additional workspace roots to activate for this session. Each path must be absolute.
- `mcpServers?: Array<McpServer>` — List of MCP servers to connect to for this session.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ResumeSessionRequest
Request parameters for resuming an existing session.

- `sessionId: SessionId` — The ID of the session to resume.
- `cwd: string` — The working directory for this session. Must be an absolute path.
- `additionalDirectories?: Array<string>` — Additional workspace roots to activate for this session. Each path must be absolute.
- `mcpServers?: Array<McpServer>` — List of MCP servers to connect to for this session.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### CloseSessionRequest
Request parameters for closing an active session.

- `sessionId: SessionId` — The ID of the session to close.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SetSessionModeRequest
Request parameters for setting a session mode.

- `sessionId: SessionId` — The ID of the session to set the mode for.
- `modeId: SessionModeId` — The ID of the mode to set.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SetSessionConfigOptionRequest
Request parameters for setting a session configuration option.

- `type: "boolean"` · {...} — A boolean value (`type: "boolean"`).
- variant · {...} — A [`SessionConfigValueId`] string value.

### PromptRequest
Request parameters for sending a user prompt to the agent.

- `sessionId: SessionId` — The ID of the session to send this user message to
- `prompt: Array<ContentBlock>` — The blocks of content that compose the user's message.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### StartNesRequest
Request to start an NES session.

- `workspaceUri?: string|null` — The root URI of the workspace.
- `workspaceFolders?: array|null` — The workspace folders.
- `repository?: NesRepository | null` — Repository metadata, if the workspace is a git repository.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### WorkspaceFolder
A workspace folder.

- `uri: string` — The URI of the folder.
- `name: string` — The display name of the folder.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesRepository
Repository metadata for an NES session.

- `name: string` — The repository name.
- `owner: string` — The repository owner.
- `remoteUrl: string` — The remote URL of the repository.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### SuggestNesRequest
Request for a code suggestion.

- `sessionId: SessionId` — The session ID for this request.
- `uri: string` — The URI of the document to suggest for.
- `version: integer` — The version number of the document.
- `position: Position` — The current cursor position.
- `selection?: Range | null` — The current text selection range, if any.
- `triggerKind: NesTriggerKind` — What triggered this suggestion request.
- `context?: NesSuggestContext | null` — Context for the suggestion, included based on agent capabilities.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesTriggerKind
What triggered the suggestion request.

- `"automatic"` — Triggered by user typing or cursor movement.
- `"diagnostic"` — Triggered by a diagnostic appearing at or near the cursor.
- `"manual"` — Triggered by an explicit user action (keyboard shortcut).

### NesSuggestContext
Context attached to a suggestion request.

- `recentFiles?: array|null` — Recently accessed files.
- `relatedSnippets?: array|null` — Related code snippets.
- `editHistory?: array|null` — Recent edit history.
- `userActions?: array|null` — Recent user actions (typing, navigation, etc.).
- `openFiles?: array|null` — Currently open files in the editor.
- `diagnostics?: array|null` — Current diagnostics (errors, warnings).
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesRecentFile
A recently accessed file.

- `uri: string` — The URI of the file.
- `languageId: string` — The language identifier.
- `text: string` — The full text content of the file.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesRelatedSnippet
A related code snippet from a file.

- `uri: string` — The URI of the file containing the snippets.
- `excerpts: Array<NesExcerpt>` — The code excerpts.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesExcerpt
A code excerpt from a file.

- `startLine: integer` — The start line of the excerpt (zero-based).
- `endLine: integer` — The end line of the excerpt (zero-based).
- `text: string` — The text content of the excerpt.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesEditHistoryEntry
An entry in the edit history.

- `uri: string` — The URI of the edited file.
- `diff: string` — A diff representing the edit.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesUserAction
A user action (typing, cursor movement, etc.).

- `action: string` — The kind of action (e.g., "insertChar", "cursorMovement").
- `uri: string` — The URI of the file where the action occurred.
- `position: Position` — The position where the action occurred.
- `timestampMs: integer` — Timestamp in milliseconds since epoch.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesOpenFile
An open file in the editor.

- `uri: string` — The URI of the file.
- `languageId: string` — The language identifier.
- `visibleRange?: Range | null` — The visible range in the editor, if any.
- `lastFocusedMs?: integer|null` — Timestamp in milliseconds since epoch of when the file was last focused.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesDiagnostic
A diagnostic (error, warning, etc.).

- `uri: string` — The URI of the file containing the diagnostic.
- `range: Range` — The range of the diagnostic.
- `severity: NesDiagnosticSeverity` — The severity of the diagnostic.
- `message: string` — The diagnostic message.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesDiagnosticSeverity
Severity of a diagnostic.

- `"error"` — An error.
- `"warning"` — A warning.
- `"information"` — An informational message.
- `"hint"` — A hint.

### CloseNesRequest
Request to close an NES session.

- `sessionId: SessionId` — The ID of the NES session to close.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### WriteTextFileResponse
Response to `fs/write_text_file`

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ReadTextFileResponse
Response containing the contents of a text file.

- `content: string` — Content payload returned by this response.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### RequestPermissionResponse
Response to a permission request.

- `outcome: RequestPermissionOutcome` — The user's decision on the permission request.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### RequestPermissionOutcome
The outcome of a permission request.

- `outcome: "cancelled"` — The prompt turn was cancelled before the user responded.
- `outcome: "selected"` · SelectedPermissionOutcome — The user selected one of the provided options.

### SelectedPermissionOutcome
The user selected one of the provided options.

- `optionId: PermissionOptionId` — The ID of the option the user selected.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### CreateTerminalResponse
Response containing the ID of the created terminal.

- `terminalId: TerminalId` — The unique identifier for the created terminal.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### TerminalOutputResponse
Response containing the terminal output and exit status.

- `output: string` — The terminal output captured so far.
- `truncated: boolean` — Whether the output was truncated due to byte limits.
- `exitStatus?: TerminalExitStatus | null` — Exit status if the command has completed.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### TerminalExitStatus
Exit status of a terminal command.

- `exitCode?: integer|null` — The process exit code (may be null if terminated by signal).
- `signal?: string|null` — The signal that terminated the process (may be null if exited normally).
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### ReleaseTerminalResponse
Response to terminal/release method

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### WaitForTerminalExitResponse
Response containing the exit status of a terminal command.

- `exitCode?: integer|null` — The process exit code (may be null if terminated by signal).
- `signal?: string|null` — The signal that terminated the process (may be null if exited normally).
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### KillTerminalResponse
Response to `terminal/kill` method

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### CreateElicitationResponse
Response from the client to an elicitation request.

- `action: "accept"` · ElicitationAcceptAction — The user accepted and provided content.
- `action: "decline"` — The user declined the elicitation.
- `action: "cancel"` — The elicitation was cancelled.
- variant · {...} — Custom or future elicitation action.

### ElicitationContentValue
Allowed wire representations for [`ElicitationContentValue`].

- variant · string — String value accepted in elicitation response content.
- variant · integer — Integer value accepted in elicitation response content.
- variant · number — Number value accepted in elicitation response content.
- variant · boolean — Boolean value accepted in elicitation response content.
- variant · Array<string> — String array value accepted in elicitation response content.

### ElicitationAcceptAction
The user accepted the elicitation and provided content.

- `content?: object|null` — The user-provided content, if any, as an object matching the requested schema.

### ConnectMcpResponse
**UNSTABLE**
> UNSTABLE / experimental area.

- `connectionId: McpConnectionId` — The unique identifier for this MCP-over-ACP connection.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### DisconnectMcpResponse
**UNSTABLE**
> UNSTABLE / experimental area.

- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### CancelNotification
Notification to cancel ongoing operations for a session.

- `sessionId: SessionId` — The ID of the session to cancel operations for.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### DidOpenDocumentNotification
Notification sent when a file is opened in the editor.

- `sessionId: SessionId` — The session ID for this notification.
- `uri: string` — The URI of the opened document.
- `languageId: string` — The language identifier of the document (e.g., "rust", "python").
- `version: integer` — The version number of the document.
- `text: string` — The full text content of the document.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### DidChangeDocumentNotification
Notification sent when a file is edited.

- `sessionId: SessionId` — The session ID for this notification.
- `uri: string` — The URI of the changed document.
- `version: integer` — The new version number of the document.
- `contentChanges: Array<TextDocumentContentChangeEvent>` — The content changes.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### TextDocumentContentChangeEvent
A content change event for a document.

- `range?: Range | null` — The range of the document that changed. If `None`, the entire content is replaced.
- `text: string` — The new text for the range, or the full document content if `range` is `None`.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### DidCloseDocumentNotification
Notification sent when a file is closed.

- `sessionId: SessionId` — The session ID for this notification.
- `uri: string` — The URI of the closed document.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### DidSaveDocumentNotification
Notification sent when a file is saved.

- `sessionId: SessionId` — The session ID for this notification.
- `uri: string` — The URI of the saved document.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### DidFocusDocumentNotification
Notification sent when a file becomes the active editor tab.

- `sessionId: SessionId` — The session ID for this notification.
- `uri: string` — The URI of the focused document.
- `version: integer` — The version number of the document.
- `position: Position` — The current cursor position.
- `visibleRange: Range` — The portion of the file currently visible in the editor viewport.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### AcceptNesNotification
Notification sent when a suggestion is accepted.

- `sessionId: SessionId` — The session ID for this notification.
- `id: NesSuggestionId` — The ID of the accepted suggestion.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### RejectNesNotification
Notification sent when a suggestion is rejected.

- `sessionId: SessionId` — The session ID for this notification.
- `id: NesSuggestionId` — The ID of the rejected suggestion.
- `reason?: NesRejectReason | null` — The reason for rejection.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

### NesRejectReason
The reason a suggestion was rejected.

- `"rejected"` — The user explicitly dismissed the suggestion.
- `"ignored"` — The suggestion was shown but the user continued editing without interacting.
- `"replaced"` — The suggestion was superseded by a newer suggestion.
- `"cancelled"` — The request was cancelled before the agent returned a response.

### CancelRequestNotification
Notification to cancel an ongoing request.

- `requestId: RequestId` — The ID of the request to cancel.
- `_meta?: object|null` — The _meta property is reserved by ACP to allow clients and agents to attach additional metadata to their interactions. Implementations MUST NOT make assumptions about values at these keys.

## 3. Harness note

`@deepseek-ai/dsh-acp` implements a strict subset of this surface over stdio: `initialize`, `authenticate`,
`session/new`, `session/list`, `session/resume`, `session/close`, `session/set_config_option`,
`session/prompt`, `session/cancel`, `$/cancel_request`, and on the client side only `session/update`
and `session/request_permission`. It sets no `_meta` and defines no custom method or capability.
