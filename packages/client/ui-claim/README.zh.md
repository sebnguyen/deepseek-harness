---
description: "Web GUI 的 claim 界面：chat turn 尾部的每轮声明状态行，显示每轮承诺了什么以及核验器如何裁定；供 claim 体验的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-claim

[English](README.md) | 中文

## 概述

Web GUI 的 claim 界面把每轮的持久声明显示为该轮尾部的一条状态行，位于 assistant 操作行（复制 / 点赞 / 点踩）正上方。声明一经声明，该行随即挂载——以动画圆点显示核验中——并在裁定后保持挂载，因此失败或被篡改的声明在完成的轮次上依然可见。悬停或聚焦芯片会显示声明目的、完成条件、最近一次核验结果，以及未通过裁定的解释。本插件只读取 `claim` session projection，不声明任何操作，也不创建声明。随附的 Web preset 会挂载它；从 web-app bundle 的 patch 中移除 `ui-claim` 行即可整体关闭该界面。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

与 `ui-chat` 一同挂载本插件；声明过 claim 的每一轮都会在其复制 / 点赞 / 点踩操作行正上方出现该状态行。声明打开时芯片显示 `核验声明中`，通过裁定后显示 `声明已通过`，未通过的裁定显示 `声明未通过` 或 `声明被篡改`。没有 claim 能力的 Session 没有 `claim` projection，什么都不渲染；未声明 claim 的轮次同样不渲染。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

芯片是纯读取端：`useProjection('claim')` 以整体快照的形式交付主机计算的按轮排序账本，turn-status 条目从中选择 `turn` 与所属 Turn 位置一致的那一行。这里没有客户端折叠、没有领域存储、也没有变更路径。`conversation.chat.turnStatus` 是 list 而非 chain，因此 claim 行可以与其他 turn-status 贡献者以及上方的 turn-tail 链共存。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-claim](../../claim/claim/README.md) — claim 领域：本界面读取的 `claim/*` 事件、projection 与裁定策略。
- [ui-chat](../ui-chat/README.zh.md) — 声明 `conversation.chat.turnStatus` slot 并拥有 turn 尾部。
- [Client 包地图](../README.zh.md) — 相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

无。芯片通过 projection 读取持久的 `claim/*` 事件并呈现给人；它不新增任何模型可见输入、提示内容或工具面。

#### KV Cache 效应

无。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **纯读取界面** — 芯片只渲染持久账本；重新运行或放弃声明仍由模型侧的既有工具完成。
