# 核心提示词指导

[English](core-prompt-guidance.md) | 中文

面向模型的系统提示词中的一方行为指导：段落顺序、标签、正文，以及如何用其替代原先的 `harness:tool-batching` 与 `harness:tool-discovery` 块。组装机制见 [system-prompt.zh.md](system-prompt.zh.md)；注册与配置字段见 [system-prompt 包 README](../../packages/core/system-prompt/README.zh.md)。

顺序名称真源：[`packages/core/system-prompt/src/index.ts`](../../packages/core/system-prompt/src/index.ts)。

## 目标

在**可缓存**的前缀中避免模型名、产品名和易变部署事实。引导智能体优先**收集上下文**（工具与 `ask_user_question`）和**行动**，而非冗长推理流。跨工具流程只在 **Core Rule** 段落中表述一次，不再单独保留 batching 与 discovery 段落。

## 段落顺序

仓库拥有的位置通过 `getSectionOrder(PromptSectionOrderName)` 解析。新位置须为**彼此至少相隔十的互异整数**（由 `system-prompt.spec.ts` 断言）。

| 顺序 | `PromptSectionOrderName` | 段落 `name` | 所有者 |
|------|---------------------------|-------------|--------|
| −1000 | `HARNESS_IDENTITY` | `harness:identity` | `dsh-system-prompt`（默认**关闭**） |
| 0 | `DEPLOYMENT_PERSONA_PREFIX` | `deployment:persona-prefix` | 配置 / `dsh-persona` — 仅部署覆盖 |
| 10 | `CORE_PERSONALITY` | `harness:core-personality` | `dsh-system-prompt` |
| 20–110 | `CORE_RULE_*` | `harness:core-rule:*` | `dsh-system-prompt`（十条规则，见英文页全文） |
| 500–900 | `PLAN_POLICY` 等 | 见英文页 | 计划模式、团队、PTC、`@` 引用等叠加层 |
| 1000+ | `TOOL_*` | `tool:*` | 各工具包 — 正文以 `Advice: ` 开头 |
| 10200 | `DEPLOYMENT_PERSONA_SUFFIX` | `deployment:persona-suffix` | 配置 / `dsh-persona` |

**已移除的位置：** `TOOL_BATCHING`（950）与 `TOOL_DISCOVERY`（960）不再作为独立段落；要求并入 **Structure Your Search**、**Context Over Inference**、**Batch Over Individual** 三条 Core Rule（英文页有完整措辞）。

## Harness 身份

默认 **`includeHarnessIdentity: false`**。若启用，开头句不得包含模型、提供方或 DeepSeek Harness 名称，以便稳定前缀在切换模型时可缓存。勿在可缓存块中使用 `{{model}}`。

## 推理流与用户回复

模型可能同时产生**推理流**（thinking）与**用户可见回复**。Think Concise 仅约束推理流：工具前一行意图、结果后一行事实；勿复述已结算的工具或检查结果；无新证据勿在流中改计划；仓库事实用 grep/read 而非假设段落。Answer Structurally 仅约束**收尾**时的用户可见回复，不用于每轮中间消息，也不要预告即将执行的工具动作。轮次中间可省略或极简用户文字。

## 核心人格与规则

**Core Personality** 以「每条规则服务于同一结果」为总纲，并给出两条解释规则：字面读法违背理由时依理由行事，两条规则冲突时由更贴合情境的理由胜出。十条 Core Rule 段落的英文正文（含每条后的 Example 行，以及 Tool Advice 范例）以 [core-prompt-guidance.md](core-prompt-guidance.md) 为准。模型可见正文须为 ASCII 友好措辞：不用箭头、unicode 破折号、省略号、markdown 强调、反引号或 glob 元字符；顺序用 then。实现与快照以该页 verbatim 文本为 oracle。

## 提示词预算

每条核心指导段落都有 `system-prompt.spec.ts` 断言的字符上限，整组段落另有一项总量上限。需要更多空间的段落在同一变更中说明理由并上调上限；收窄的段落则下调上限，使提示词不会逐句无声累积。上限不是删减目标，而是记录下来的实际规模：只有在文本仍承载原有全部理由与义务时，更低的数字才成立。

## 工具建议（`Advice:`）

`TOOL_READ` 及之后的各 `tool:*` 段落正文以 **`Advice: `** 开头，用一至两句说明该工具做什么、为何优于替代做法，随后是 **`Example:`** 一行。由提示词之外的机制强制的要求，在理由之后仍以义务句形式保留。不重复 Core Rules。

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `includeHarnessIdentity` | `false` | 为 true 时注册 `harness:identity` |
| `includeCorePersonalityGuidance` | `true` | 注册 `harness:core-personality` |
| `includeCoreRulesGuidance` | `true` | 注册全部 `harness:core-rule:*`（prove-it 随 claim 工具门控） |
| `personaPrefix` / `personaSuffix` | `''` | 部署可选覆盖 |

实现与本页一致后，移除 `includeToolBatchingGuidance` 与 `includeToolDiscoveryGuidance`，改用 `includeCoreRulesGuidance`。

## 实现清单

见英文页 **Implementation checklist**；实现 PR 须附 [Agent Note](../../.agents/notes/README.zh.md#when-to-write-one)。
