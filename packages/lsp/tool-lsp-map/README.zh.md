---
description: "The model-facing symbols tool: batches documentSymbol outlines per file into a condensed, path-anchored symbol layout with kind abbreviations, optional in/out hotspot counts, and per-file/per-batch caps, for users and maintainers composing folder-scale code maps."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-lsp-map

[English](README.md) | 中文

## 概述

`dsh-tool-lsp-map` 让模型通过一次 `symbols` 调用构建文件夹级的符号地图：把 `glob` 的结果传入 `files`，工具对每个文件执行一次 `documentSymbol` 映射查询，并把每个大纲展平为一行紧凑、以路径锚定的文本。输出仅含 ASCII（无图形符号），把每种符号类型缩写为固定的缩写词，并可选择性地追加一跳 `in:`/`out:` 调用与被调用计数。上限按 `filesPerBatch` → `symbolsPerFile` → `maxResultChars` 依次生效，每层都有明确的省略标记，使超大文件夹的地图保持有界。该包需要一个声明了 `documentSymbolProvider` 的 LSP Provider，以及会话工作区根目录。它与 `dsh-tool-lsp` 的 `callers`/`callees` 操作配合：本工具只做计数，精确调用点由那两个操作返回。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

模型在进入读取循环前映射一个文件夹：先用 `glob` 圈定子树，再把返回的文件路径传给 `symbols`。

### 工具

`symbols` 接收 `files`（`glob` 返回的源文件路径）与可选的 `hotspots` 布尔值。每个文件渲染为：

```
path: [ :line (abbrev) name in:n out:m ; … ]
```

`in:` 是一跳的调用者计数；`out:` 是被调用者计数。两者仅在启用 `hotspots` 时出现（每个保留符号多两次映射查询）。`line` 为基于 1 的行号。

### 模型得到什么

每个文件一行，符号条目紧凑排列，并有三类省略标记：被截断文件末尾的 `… +N more symbols`、末尾的 `… +N more files omitted`，以及 `maxResultChars` 处的整体截断标记。不在固定 `KIND_ABBREV` 表中的符号类型（字段、变量、常量）会被折叠掉。文件内容从不进入模型上下文——只有压缩后的布局。

### 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `filesPerBatch` | 100 | 内联展示的最大文件数，之后追加省略标记 |
| `symbolsPerFile` | 200 | 单个文件贡献的保留符号上限，之后追加 `… +N more symbols` |
| `maxResultChars` | 16000 | 完整渲染文本上限（含截断标记） |
| `hotspots` | false | 追加 `in:`/`out:` 计数（每个符号多 2 倍映射查询） |
| `timeoutMs` | 120000 | 工具调用协作超时预算 |

<a id="understand-the-implementation"></a>
## 实现说明

- **命名空间插件。** 具名导出 `name`/`inject`/`Config`/`apply`，无默认导出。
- **以 Seam 为先。** `ctx.lsp.mapQuery`（`dsh-lsp`）是唯一数据源；本包仅通过 Provider 读取源码。不注入 `fs`。
- **展平 + 分级。** `flattenSymbols` 深度优先遍历递归 `documentSymbol` 树，只保留 `KIND_ABBREV`（`kind.ts`）中的类型，其余折叠。
- **热区只计数，不列明细。** `countCalls` 对每个保留符号执行一跳 `callers`/`callees`，只保留边数量——精确调用点留在 `dsh-tool-lsp` 的 `callers`/`callees` 中。
- **系统提示。** 一个节（`tool:lsp-map`，位置 `TOOL_LSP_MAP`）承载固定的 `in:`/`out:` 图例，使模型无需推断缩写。

<a id="model-experience"></a>
## 模型体验

| 效果 | 机制 |
|---|---|
| 一次调用得到文件夹地图 | `symbols` 对 `files` 批量执行 `documentSymbols` |
| 调用关系信号 | 一跳 `in:`/`out:` 计数 |
| 精确调用点 | 延后到 `lsp` `callers`/`callees` |
| 上下文有界 | 每文件/每批/字节上限 + 省略标记 |

Token 与 KV-cache 影响与渲染文本成正比，受 `maxResultChars` 约束。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **尚无溢出与结构化 `map` 卡片。** 超限结果以省略标记呈现（不写入溢出文件），`presentResult` 尚未为 UI 持久化结构化符号树卡片。二者为后续工作。
- **`workspace/symbol`（全局符号查找）尚未实现。** `symbols` 依赖逐文件的 `documentSymbol`；仓库级模糊符号索引后置。
- **映射查询串行。** `dsh-lsp-stdio` 通过每个工作区一个队列服务 `documentSymbol`/调用层级；在并行扇出落地前，文件夹扫描受该队列的延迟约束。
- **热区开销大。** 每个保留符号需两次调用层级往返；200 个符号的文件即 400 次额外请求，因此 `hotspots` 默认关闭。
- **`deprecated`/`detail` 未在紧凑布局中呈现**（为保密度而省略）；`detail` 消歧保留在 `dsh-tool-lsp` 的边输出中。
