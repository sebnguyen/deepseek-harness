# LSP folder map (`symbols`) and map seam operations

Status: implemented

## Problem

Position-scoped `lsp` navigation did not expose folder-scale structure: no batched `documentSymbol` outlines or call-hierarchy counts for discovery before read cycles.

## Decision

Extend the LSP capability with map operations (`documentSymbols`, `callers`, `callees`) through `lsp-stdio` translation, add `callers`/`callees` on `tool-lsp`, and ship `@deepseek-ai/dsh-tool-lsp-map` with a `symbols` tool that batches per-file outlines into ASCII, path-anchored lines with optional one-hop `in:`/`out:` counts and cascading caps. Register `TOOL_LSP_MAP` system-prompt guidance after the fixed LSP sections. `tool-lsp-map` also registers `tool:discovery` at `TOOL_DISCOVERY` (after tool-batching) when `glob`, `lsp`, and `read` are mounted, describing glob → symbols → callers/callees → read.

## Consequences

Folder maps depend on a language server that advertises `documentSymbolProvider` (and call hierarchy for hotspots). Exact call edges remain on `tool-lsp`; `symbols` only counts unless the model follows up with lazy caller/callee queries.
