---
description: "Web 后台活动表面：input-dock 的 chip 与抽屉，在 session-controller 镜像之上统一当前会话的 jobs 与 subagent；面向后台活动体验的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-activity

[English](README.md) | 中文

## 概述

本包渲染 Web GUI 的后台活动表面：一个停靠在 composer 上方的 chip，在 session 拥有至少一个后台项时出现；一个抽屉在 sticky 座内、composer chip 之下以普通流滑出展开，座底固定，把 chip 与输入卡片顶到其固定高度面板之上，两个方向都有动画；详情面板实时尾随所选 job 的输出行。一个行模型把会话镜像的 jobs 与其直接 subagent 后代合并；树把活行与归档分开，详情面板展示 job 的结论文本，或进入 subagent 完整 session 视图的入口。所有事实都经 Session Controller 的镜像到达——`jobsBySession`、`subagentsByParent` 与会话摘要——两个注入回调经 sessions 服务的目录动词路由，因此本包不发起任何 RPC。模型对同一批 job 的视图属于 `dsh-tool-jobs`；本包是面向人的只读投影。

## 目录

- [使用本包](#使用本包)
- [理解实现](#理解实现)
- [Further Exploration](#further-exploration)
- [模型体验](#模型体验)
- [已知限制与推迟工作](#已知限制与推迟工作)
- [Dev Note](#dev-note)

-----

<a id="使用本包"></a>
## 使用本包

把插件与运行时一并挂载；每当 session 拥有至少一个 job 或 subagent，chip 就会出现在 input dock。它的徽标统计活着的工作——在跑的 job 加在跑的 subagent——为正时带旋转 glyph；当只剩已落定的行时徽标省略。点击 chip 在 composer 下方打开抽屉：Live 节按开始时间列出在跑的工作；Archive 节折叠在带计数的头部之下、位于“仅看活着”过滤之后，保留已落定的 job（失败细节清晰可读）与不再活动的 subagent，按最近落定排序。选中一个 job 行显示其结论——存在时取生产方的 detail，否则取状态词；选中一个 subagent 行显示其状态与“作为会话打开”控件——在父会话目录就绪前禁用——经其精确地址路由该子会话。ArrowUp 与 ArrowDown 在可见行之间移动，Escape 关闭抽屉并把焦点还给 chip。

### 它所承载的退役

本包取代已退役的头部 jobs 弹出层；安静入口、零活角标与可读失败细节的决策原样保留。头部的 subagent 目录保留，直到计划中的抽屉树接管其约定。

-----

<a id="理解实现"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本包向 `conversation.input.dock` 贡献一个条目（`ActivityDock`），以 `inject` 回调注册，闭包读取 `ctx.sessions`：`onRefresh` 是现有的 `refreshSubagents(parentSessionId)` 触发，每次打开触发一次，使 subagent 行获得目录标签与模式；`onOpenChild` 经 `subagentAddress` 解析子会话保留的地址并交给 `openSubagent`，与目录所用导航相同。`model.ts` 是纯投影：job 记录原样成为行；直接 subagent 子项从会话摘要读取并由就绪的目录细化；`sections` 将活行按开始时间排序、已落定行按最近落定排序，同一毫秒的平手以开始时间为准。行时钟仅在打开的抽屉显示活工作时每秒走秒一次。抽屉在 sticky composer 座内以普通流生长：座底固定，打开高度把 chip 与输入卡片以单一流几何顶起，面板相对自身盒子裁剪而非铺满窗口，高度过渡双向滑动。座高发布（ui-conversation 的 syncSeatMetrics）在开合过渡期间冻结 --dsh-composer-height 的重写、结束时重锚一次，动画因此不按帧重解依赖的 chat 边栏。关闭时可见性的一段在过渡结束后落下，保住下滑动画。选中 job 行时，终端风格面板尾随其 jobOutput 镜像缓冲行并跟随最后一行。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

当活动表面不够时读这些页面。它们从浏览器抽屉走向注册表与面向模型的工具。

- [dsh-tool-jobs](../../jobs/tool-jobs/README.zh.md) —— 同一注册表上面向模型的 jobs 工具。
- [Session Controller](../../api/session-controller/README.zh.md) —— 折叠本包读取的镜像。
- [ui-subagent](../ui-subagent/README.zh.md) —— 其头部触发器将随计划中的抽屉树退役的 subagent 目录。
- [Web background-activity drawer](../../../.agents/notes/proposed/feature/2026-09-30-web-background-activity-drawer.zh.md) —— 本包实现的设计笔记。

-----

<a id="模型体验"></a>
## 模型体验

无：本包为人渲染宿主计算的镜像状态，不触碰 prompt、消息、schema、流或工具结果。

#### KV Cache 影响

无；本包从不组装或发送 provider 请求。

## 已知限制与推迟工作

<a id="已知限制与推迟工作"></a>


这些限制定义第一阶段的抽屉。它们是当前的包约束，不是任务清单。

- **树是扁平的** —— 后代嵌套不超过 session 的直接 subagent 子项；子会话自己的 job 是该子会话的行，而非父会话的。后代 jobs 帧与懒展开后代树是设计笔记的第二阶段。
- **行展示状态但不能取消** —— 取消欠着 2026-08-08 笔记记录的对模型可见的决策：`kill()` 会把终态交付标记为已报告，人类的打断会让模型以为其 job 仍在运行。
- **job 行展示结论而非原始输出** —— 终端尾巴随本包旁边建设中的 job-output 通道；该客户端镜像落地后详情面板获得保留行。抽屉也不嵌入 subagent transcript：“作为会话打开”是 P1 通往子会话的路径，嵌入式只读 transcript 是第二阶段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包。本包是把列表镜像投影到一个 input-dock 槽位条目的只读投影。它不发出 Cordis 事件，不拥有跨插件可变状态，其单一槽位注册通过 HMR 安全规范证明 disposal。
