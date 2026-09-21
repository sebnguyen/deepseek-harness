---
description: "The model-facing symbols tool: batches documentSymbol outlines per file into a condensed, path-anchored symbol layout with kind abbreviations, optional in/out hotspot counts, and per-file/per-batch caps, for users and maintainers composing folder-scale code maps."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-lsp-map

English | [中文](README.zh.md)

## Summary

`dsh-tool-lsp-map` lets a model build a folder-scale symbol map in one `symbols` call: pipe a `glob` result into `files`, and the tool runs one `documentSymbol` map query per file, flattening each outline into a condensed, path-anchored line. The output is ASCII-only (no glyphs), abridges each symbol kind to a pinned abbreviation, and can optionally append one-hop `in:`/`out:` caller/callee counts. Caps cascade `filesPerBatch` → `symbolsPerFile` → `maxResultChars`, each with an explicit omission marker, so a map of a very large folder stays bounded. The package requires a configured LSP provider that advertises `documentSymbolProvider`, and a session workspace root. It composes with `dsh-tool-lsp`'s `callers`/`callees` operations, which return the precise call sites this tool only counts.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

An agent maps a folder before entering read cycles: `glob` a subtree, then pass the returned file paths to `symbols`.

### The tool

`symbols` takes `files` (source paths a `glob` returned) and an optional `hotspots` boolean. Each file renders as:

```
path: [ :line (abbrev) name in:n out:m ; … ]
```

`in:` is the one-hop incoming-callers count; `out:` is the outgoing-callees count. Both appear only when `hotspots` is enabled (two extra map queries per kept symbol). A symbol the server reports as having no call hierarchy (a type, constant, interface, or struct) counts as `in:0 out:0` instead of failing the map. `line` is one-based.

### What the model gets back

One line per file, packed symbol entries, and three omission markers: `… +N more symbols` per truncated file, a trailing `… +N more files omitted`, and a whole-result truncation marker at `maxResultChars`. Symbol kinds outside the pinned `KIND_ABBREV` table (fields, variables, constants) are collapsed out. File contents are never read into the model's context — only the compressed layout.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `filesPerBatch` | 100 | Max files outlined inline before the trailing omission marker |
| `symbolsPerFile` | 200 | Max kept symbols one file contributes before `… +N more symbols` |
| `maxResultChars` | 16000 | Complete rendered-text cap, including truncation marker |
| `hotspots` | false | Append `in:`/`out:` counts (2× map queries per symbol) |
| `timeoutMs` | 120000 | Cooperative tool-call timeout budget |

<a id="understand-the-implementation"></a>
## Understand the implementation

- **Namespace plugin.** Named exports `name`/`inject`/`Config`/`apply`, no default export.
- **Seam-first.** `ctx.lsp.mapQuery` (`dsh-lsp`) is the single data source; this package reads sources only through the provider (`dsh-lsp-stdio` reads them via `ctx.fs`). No `fs` injection.
- **Flatten + tier.** `flattenSymbols` walks the recursive `documentSymbol` tree depth-first and keeps only kinds present in `KIND_ABBREV` (`kind.ts`); everything else collapses.
- **Hotspots are counted, not listed.** `countCalls` runs one-hop `callers`/`callees` per kept symbol and keeps only the edge length — the actual call sites stay in `dsh-tool-lsp`'s `callers`/`callees`.
- **System prompt.** A section (`tool:lsp-map`, order `TOOL_LSP_MAP`) carries the pinned `in:`/`out:` legend so the model never infers an abbreviation. The ordered discovery flow is core-owned (`harness:tool-discovery` in `dsh-system-prompt`), so this package contributes the legend only.

<a id="model-experience"></a>
## Model Experience

| Effect | Mechanism |
|---|---|
| Folder map in one call | `symbols` batches `documentSymbols` per `files` |
| Call-relationship signal | optional `in:`/`out:` counts (one-hop) |
| Precise call sites | deferred to `lsp` `callers`/`callees` |
| Context bounded | per-file/per-batch/byte caps + omission markers |

Token and KV-cache effects are proportional to the rendered text, bounded by `maxResultChars`.

<a id="known-limitations"></a>
## Known Limitations and Deferred Work

- **No spill or structured `map` card yet.** Over-cap results are omission-marked (not written to a formatted spill file), and `presentResult` does not yet persist a structured symbol-tree card for the UI. Both are follow-ups.
- **`workspace/symbol` (global symbol finder) is not implemented.** The `symbols` tool relies on `documentSymbol` per file; a repository-wide fuzzy symbol index is deferred.
- **Serialized map queries.** `dsh-lsp-stdio` serves `documentSymbol`/call-hierarchy through one per-workspace queue; a folder scan is latency-bound on that queue until parallel fan-out lands.
- **Hotspots are expensive.** Each kept symbol costs two call-hierarchy round-trips; on a 200-symbol file that is 400 extra requests, so `hotspots` defaults off.
- **`deprecated`/`detail` are not surfaced** in the condensed layout (kept out to preserve density); `detail` disambiguation lives in `dsh-tool-lsp`'s edge output instead.
