# Agent Note: 不可调用符号的调用层次

Status: implemented

[English](2026-09-21-call-hierarchy-non-callable-symbol.md) | 中文

## Problem

当服务器在请求位置没有可调用的符号时，带有 `hotspots: true` 的 `symbols` 调用——以及 `lsp` 工具的 `callers`/`callees` 操作——会让整个查询失败。对于类型、常量、接口或结构体，gopls 会以 JSON-RPC 错误响应（`{"code":0,"message":"<name> is not a function"}`）回答 `textDocument/prepareCallHierarchy`，而不是协议约定的 `null` 结果。`LspInstance.runMapRequest` 会传播该拒绝，因此一个不可调用的符号就会中止整个文件夹的布局：模型收到的是 `Error: FlagReason is not a function`，而不是它请求的符号大纲。

## Decision

`LspInstance.runMapRequest` 捕获调用层次起始请求的失败，当该失败既不是连接保留的传输故障、也不是已中止的查询时，返回该 seam 既有的空根结果（`{ kind: 'callEdges', root: null, edges: [] }`）。`documentSymbols` 的服务器错误响应、prepare 期间的传输故障，以及 prepare 期间的取消，仍然照常拒绝。

## Alternatives considered

**匹配服务器的消息文本。** 已拒绝：该 seam 依据错误码而非消息字符串进行路由，且 “<name> is not a function” 只是某个服务器的措辞，不构成稳定契约。

**在消费方降级，把失败的一跳计为 0。** 已拒绝：消费方只能看到错误对象，无法区分服务器的“不可调用”回答与传输已死；服务器崩溃时会被渲染成全零的映射。

**在抛出的错误中保留 JSON-RPC 错误码并据此路由。** 已拒绝：gopls 发送的是错误码 `0`（通用），该码不携带任何判别信息；为此拓宽连接的错误类型只会增加表面积而无判别力。

## Consequences

不可调用的符号保留其大纲行，并在热点映射中报告 `in:0 out:0`；`lsp` 工具渲染其既有的 “No symbol at this cursor.” 一行。映射不再区分“不可调用”与“确实没有调用方”，这与服务器自身的调用图一致：无论哪种情况，它对该符号都不持有边。传输故障与取消仍然显式失败，因此死掉的服务器绝不会被读成零调用方的映射。

## Verification

`packages/lsp/lsp-stdio/tests/instance.spec.ts` 固化了 `callers` 与 `callees` 两者的降级行为，以及三条仍然拒绝的路径：`documentSymbols` 的错误响应、prepare 期间的传输故障，以及 prepare 期间的中止。`tests/fixture-server.ts` 新增 `LSP_FAKE_PREPARE_ERROR` 以及这些用例所驱动的映射操作结果变量。
