# Agent Note: Call hierarchy over a non-callable symbol

Status: implemented

English | [中文](2026-09-21-call-hierarchy-non-callable-symbol.zh.md)

## Problem

A `symbols` call with `hotspots: true` — and the `lsp` tool's `callers`/`callees` operations — failed the whole query when the server had no callable symbol at the requested position. gopls answers `textDocument/prepareCallHierarchy` for a type, constant, interface, or struct with a JSON-RPC error response (`{"code":0,"message":"<name> is not a function"}`) instead of the protocol's `null` result. `LspInstance.runMapRequest` propagated that rejection, so one non-callable symbol aborted an entire folder layout: the model received `Error: FlagReason is not a function` instead of the outline it asked for.

## Decision

`LspInstance.runMapRequest` catches the failure of the call-hierarchy start request and, when it is neither the connection's retained transport failure nor an aborted query, returns the seam's existing null-root result (`{ kind: 'callEdges', root: null, edges: [] }`). A server error response for `documentSymbols`, a transport failure during prepare, and cancellation during prepare still reject.

## Alternatives considered

**Match the server's message text.** Rejected: the seam routes on error codes, not message strings, and "<name> is not a function" is one server's wording that carries no stable contract.

**Degrade inside the consumers, counting a failed hop as 0.** Rejected: a consumer sees only the error object, so it cannot separate a server's "not callable" answer from a dead transport; a crashed server would render as an all-zero map.

**Preserve the JSON-RPC error code in the thrown error and route on it.** Rejected: gopls sends code `0` (generic), so the code carries no discriminator; widening the connection's error type for it adds surface without one.

## Consequences

A non-callable symbol keeps its outline row and reports `in:0 out:0` in a hotspots map; the `lsp` tool renders its existing "No symbol at this cursor." line. The map no longer distinguishes "not callable" from "genuinely no callers", which matches the server's own call graph: it holds no edges for such a symbol either way. Transport failures and cancellation stay loud, so a dead server never reads as a zero-caller map.

## Verification

`packages/lsp/lsp-stdio/tests/instance.spec.ts` pins the degradation for both `callers` and `callees`, plus the three still-rejecting paths: a `documentSymbols` error response, a transport failure during prepare, and an abort during prepare. `tests/fixture-server.ts` gains `LSP_FAKE_PREPARE_ERROR` and the map-operation result variables those cases drive.
