# Agent Note: Knowledge note store unfenced writes

Status: implemented

English | [中文](2026-09-19-knowledge-notes-unfenced-store-writes.zh.md)

## Problem

`@deepseek-ai/dsh-knowledge-notes` wrote note JSON through `ctx.fs.writeText`. Under `SandboxedFileSystem`, note paths under `<dshHome>/knowledge/notes` sit outside the workspace root, so `upsert_note` failed in `read-only` and `workspace-write` even though notes are harness-owned state, not model-controlled workspace mutation.

## Decision

`NoteStore.put` and `NoteStore.remove` persist through `node:fs/promises` (`mkdir` + `writeFile`), matching `session-persistence-jsonl` for derived harness-home data. Reads keep using `ctx.fs` for path resolution shared with the tools. Note files remain writable under every sandbox mode; only paths derived from the configured store root are written.

## Alternatives considered

**Thread sandbox policy into `ctx.fs.writeText` for note paths.** Rejected: it couples the store to fence internals, adds undeclared sandbox imports, and still cannot reach paths outside the workspace under `workspace-write`.

## Consequences

Note persistence is deliberately unfenced: any process that can load the plugin can write under `<dshHome>/knowledge/notes`. That matches the feature trust model (agent-writable local state, never a model-supplied path). Unit tests that mount bare `LocalFileSystem` do not catch regressions to fenced writes.

## Verification

`packages/knowledge/knowledge-notes/tests/sandbox-composition.spec.ts` boots `SandboxPolicyService`, `SandboxedFileSystem`, and the plugin; it places workspace and note home outside temp auto-grants and asserts `store().put` succeeds in every sandbox mode while a direct `ctx.fs.writeText` outside the workspace remains denied.
