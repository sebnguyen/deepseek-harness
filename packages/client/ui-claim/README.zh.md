---
description: "Web GUI 的 claim 界面：chat turn 尾部的逐轮声明芯片，以及输入框中的 Claims 下拉；供 claim 体验的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-claim

[English](README.md) | 中文

## 概述

Web GUI 的 claim 界面把 Session 的持久声明显示为两个位置的紧凑状态芯片。每轮尾部列出该轮声明的所有声明——无论待决还是已裁定——芯片以声明的 `title` 加上状态圆点（核验中为蓝色、通过为绿色、失败或被篡改为红色）；点击芯片会展开详情卡（标题、描述、原始核验脚本、最近一次运行与未通过原因）。输入框的 accessory 行带有一个紧凑的 `Claims` 触发器，其聚合圆点——任一声明失败为红色、仍有待决为蓝色、全部通过为绿色——点击后打开下拉菜单，列出最新一轮的声明。本插件只读取 `claim` session projection，不声明任何操作，也不创建声明。随附的 Web preset 会挂载它；从 web-app bundle 的 patch 中移除 `ui-claim` 行即可整体关闭该界面。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

与 `ui-chat` 一同挂载本插件。每轮的操作行随即列出该轮的声明——已裁定的仍然可见——一旦存在声明，输入框会显示 `Claims` 下拉触发器。没有 claim 能力的 Session 没有 `claim` projection，什么都不渲染；未声明 claim 的轮次在操作行不渲染任何内容。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

芯片是纯读取端：`useProjection('claim')` 以整体快照的形式交付主机计算的按轮排序账本。action-row 条目把账本过滤到所属 Turn；输入框触发器过滤到最新一轮，并根据裁定态推导聚合圆点。这里没有客户端折叠、没有领域存储、也没有变更路径。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- `@deepseek-ai/dsh-claim`（`packages/claim/claim`）— claim 领域：本界面读取的 `claim/*` 事件、projection 与裁定策略。
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
