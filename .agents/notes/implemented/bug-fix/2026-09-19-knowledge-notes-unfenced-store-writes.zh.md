# Agent Note: 知识笔记存储绕过沙箱写入

Status: implemented

[English](2026-09-19-knowledge-notes-unfenced-store-writes.md) | 中文

## Problem

`@deepseek-ai/dsh-knowledge-notes` 曾通过 `ctx.fs.writeText` 写入笔记 JSON。在 `SandboxedFileSystem` 下，`<dshHome>/knowledge/notes` 位于工作区之外，因此在 `read-only` 与 `workspace-write` 下 `upsert_note` 会失败，尽管笔记是 harness 自有状态，而非模型对工作区的受控修改。

## Decision

`NoteStore.put` 与 `NoteStore.remove` 通过 `node:fs/promises`（`mkdir` + `writeFile`）持久化，与 `session-persistence-jsonl` 对 harness home 派生数据的写法一致。读取仍使用 `ctx.fs`，与工具共享路径解析。笔记文件在任意沙箱模式下可写；仅写入由存储根派生的路径。

## Alternatives considered

**为笔记路径向 `ctx.fs.writeText` 传入沙箱策略。** 已拒绝：使存储与围栏内部机制耦合、引入未声明的沙箱依赖，且在 `workspace-write` 下仍无法写入工作区外路径。

## Consequences

笔记持久化刻意不经过围栏：能加载该插件的进程均可写入 `<dshHome>/knowledge/notes`。这与功能的信任模型一致（agent 可写的本地状态，绝非模型提供的路径）。仅挂载裸 `LocalFileSystem` 的单元测试无法捕获回退到围栏写入的回归。

## Verification

`packages/knowledge/knowledge-notes/tests/sandbox-composition.spec.ts` 启动 `SandboxPolicyService`、`SandboxedFileSystem` 与插件；将工作区与笔记 home 置于 temp 自动授权之外，断言各沙箱模式下 `store().put` 成功，而工作区外的直接 `ctx.fs.writeText` 仍被拒绝。
