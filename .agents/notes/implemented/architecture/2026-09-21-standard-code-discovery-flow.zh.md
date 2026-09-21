# Agent Note: 标准的代码探查流程由核心 system-prompt 拥有

Status: implemented

[English](2026-09-21-standard-code-discovery-flow.md) | 中文

## Problem

有序的代码探查流程——glob、勾勒结构、grep、read——此前仅由 `@deepseek-ai/dsh-tool-lsp-map` 送达模型。该包注册 `tool:discovery` 提示词节，并且只有当 `glob`、`lsp` 与 `read` 三个工具都已挂载时才输出它。没有任何随附 bundle 挂载 `dsh-tool-lsp-map`：只有 `do-standard` 示例 overlay 与一个快照 fixture 会挂载。可与之类比的跨工具建议 `harness:tool-batching` 由 `@deepseek-ai/dsh-system-prompt` 拥有并在每个 profile 中输出，而该指导早已无条件地提及 `lsp`。因此该流程在所有随附部署中都不存在。

## Decision

`dsh-system-prompt` 以内置节 `harness:tool-discovery` 拥有该标准流程，顺序为 `960`，紧接 `harness:tool-batching`（`950`）之后、各工具节之前。其文本是建议性且有序的：用 glob 找到候选文件，在存在符号工具时用 symbols 勾勒其结构，用 grep 定位所需的定义与用法，然后只读取真正需要的文件。符号步骤是可选的而非必需的，因此该建议不声明任何部署必须具备的能力，在没有挂载符号工具时同样成立。`includeToolDiscoveryGuidance`（默认 `true`）为自行拥有探查指导的部署关闭该节，与 `includeToolBatchingGuidance` 一致。`dsh-tool-lsp-map` 不再注册 `tool:discovery`；它保留承载固定 `in:`/`out:` 图例的 `tool:lsp-map` 节。

## Alternatives considered

**放宽 LSP map 的门控，使该流程在存在 `glob` 与 `read` 时即输出。** 已拒绝：通用探查建议仍将归 LSP 包所有，且文本仍会提及没有该 seam 的部署无法调用的 `symbols` 与 `lsp` 工具。

**在 `dsh-base` 中挂载 `dsh-lsp`、`dsh-tool-lsp` 与 `dsh-tool-lsp-map`，让该流程与其提及的工具一同随附。** 已拒绝：这会在没有任何已配置语言服务器的情况下加入面向模型的工具，于是每个未提供服务器的部署在调用时都会让 `lsp` 与 `symbols` 失败。

**无条件输出该节，不提供配置字段。** 已拒绝：其他每个第一方指导节都可由拥有该指导的部署关闭，而一个拥有自己探查指导的组合将不得不遮蔽一个保留的内置名称，而非直接关闭它。

## Consequences

每个 profile 都在 batching 指导与各工具规则之间多携带一个提示词节，因此组装后的提示词增加一个段落，节序随之改变。`dsh-tool-lsp-map` 不再为门控而从 `ctx.tools` 读取 `glob` 与 `read`；它保留 `tools`、`lsp` 与 `systemPrompt` 注入。没有符号工具的部署会读到它无法运行的符号步骤；这是有意为之，因为该步骤限定为可选，而周围的路径（grep、read）始终适用。

## Verification

`packages/core/system-prompt/tests/system-prompt.spec.ts` 固化默认输出、带可选符号步骤的有序流程，以及在 `includeToolDiscoveryGuidance: false` 下的抑制。`packages/fs/tool-fs/tests/tools.spec.ts` 与 `packages/shell/tool-bash/tests/tools.spec.ts` 中的节列表与渲染提示词基准已带上该新内置节。`docs/config-catalog.md` 已重新生成并包含新字段。
