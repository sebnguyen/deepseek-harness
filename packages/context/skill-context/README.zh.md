---
description: "决策模型驱动的 skill 准入：在每个 pre-step 判断目录中的每个 skill，并注入该判断所准入的正文，供配置或调试该插件的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-context

[English](README.md) | 中文

## 概述

本包依据决策模型的判断把 skill 正文准入模型的上下文窗口，而不是把选择留给模型。在每个 `agent/pre-step`，它向 `ctx.decision` 为每个可被模型调用的 skill 发送一个 Noul 问题，并为答案所准入的每个 skill 发出一条 `skill-invocation` 注入。正文已在窗口中的 skill 绝不会被再次发出，因此重复的判断不发出任何内容。每一种不明确的情形都会保持不动：provider 缺失、目录观测不完整或插件被禁用，都会让窗口保持原样。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与推迟的工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当应由一项判断而非模型来决定哪些 skill 正文进入窗口时，挂载本插件。默认没有任何组合挂载它，因此需要由 profile patch 显式加入。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | pre-step 判断是否运行。 |
| `provider` | `'typesafe'` | 判断的来源；`none` 保留 `ctx.decision` 但不注册求值器。 |
| `threshold` | `0.5` | 准入候选的概率阈值，取值范围 `(0, 1]`。 |
| `topK` | `3` | 每个 step 准入的 skill 数量上限。 |
| `model` | `typesafe` 下必填 | 钉住的模型标识符；使用别名会在无通知的情况下改变阈值含义。 |
| `endpoint` | TypeSafe 评测端点 | 评测端点。 |
| `timeoutMs` | `10000` | 单次调用超时。 |

`typesafe` provider 缺少 `model`、阈值超出 `(0, 1]`、`topK` 非正数，都会在加载时失败，而不是降级运行。

<a id="understand-the-implementation"></a>
## 理解实现

`ctx.decision` 是该能力：一次调用携带一份 state 与一组带类型问题，返回带类型答案。Service Definition 与它的唯一 Consumer 同包发布，因为这里由一个 provider 服务一个 Consumer；出现第二个 provider 或 Consumer 即是拆分它的触发条件。

插件用 `Session.deriveMessages()` 读取活跃窗口——这是派生投影：surface 是它的唯一来源，因此一次 compaction `replace` 会把被遮蔽的注入从派生结果中移除，而每个 surface 节点只被投影一次。它从不解析事件位置，因为同步的任意位置读取器已被弃用。

只要判断会不可靠，准入就会保持不动——不完整的目录观测会让它回答一组不完整的问题，从而拒绝模型所需要的 skill。

## Model Experience

### 请求上下文与触发条件

插件在 step 的请求之前，为每个被准入的 skill 添加一条持久的 user 角色消息。每条都携带已发布的 `skill-invocation` source（`kind`、`name`、`form: 'instructions'`）以及渲染后的 `<skill_content>` 正文。

#### 模型看到什么

该 skill 自身的指令正文，位于与 `/name` 手势所产生的同一个 `<skill_content>` 块内。目录框架与 `skill` 工具 schema 均未改动。

## Known Limitations and Deferred Work

该判断读到的是相关性而不是结果证据，因此它可以在减少上下文的同时仍然错过模型所错过的同一批 skill。准入只做追加：skill 正文会留在窗口中直到 compaction 将其遮蔽，因此剩余容量单调不增，而因空间不足被拒绝的 skill 会一直保持被拒绝，除非 compaction 收回空间。

每次准入都会被持久记录为 `skill-invocation`，与用户手势产生的 source kind 相同，因此日志无法区分由判断产生的准入与手工加载的 skill。

## Dev Note

运行 `pnpm exec vitest run packages/context/skill-context/tests/skill-context.spec.ts` 获取聚焦覆盖。
