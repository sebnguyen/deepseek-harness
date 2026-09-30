# Agent Note: 轮次过程实时折叠

Status: implemented

[English](2026-09-30-live-turn-process-folding.md) | 中文

## 问题

紧凑 transcript 折叠此前只作用于已关闭轮次：轮次运行期间，所有上下文注入、Think、Tool 与中间 Assistant 行完整展开，直到 `turn/end`，于是长时间运行的 agent 轮次会把过程材料灌满阅读面——而已完成轮次的设计早已把这些视为次要内容。已完成轮次的 disclosure 还会把折叠详情体从 DOM 清除（DisclosureRow 卸载收起的 children），导致折叠的推理与上下文文本从浏览器查找中悄悄消失。

## 决策

**紧凑模式对打开的轮次实时折叠。** 轮次过程投影器为打开的轮次推导最新一条带回复内容的 Assistant 步骤（`liveStep`）以及该轮是否带有可折叠证据（`liveFoldable`：一个非重试、非独立、位于过程起点之后且不是最新行的行）。ChatNodeSeat 在轮次打开期间隐藏除 `liveStep` 行之外的所有过程成员；model-retry 行在两种模式下都保持独立。`turn/end` 时 seat 原子切换到已定稿的答案边界折叠，实时展开移交给持久化的「轮次 + 正文步骤」条目。

**手动展开存于会话存储，以轮次为键、正文步骤可为空。** 空 `answerStep` 条目记录打开轮次的实时展开，使同一轮次的每个成员 seat 共享同一打开状态；已定稿条目照旧记录正文 generation。存储不混用两者：打开已定稿 generation 会替换空步骤条目，关闭实时展开不会删除已定稿条目。

**运行中控件是如实摘要。** 其工具调用、消息与 subagent 计数覆盖轮次全部持久化事件；运行期间最新可见行尚不是「较早消息」，因此消息计数比整轮数字小一。计数全为零时，轮次打开显示「处理中」（英文 `Working`），关闭后沿用「已思考」。

**DisclosureRow 按需保留收起 children 的挂载。** `keepChildrenMounted` 属性把收起的 `children` 渲染进 `hidden="until-found"` 包裹层；ReasoningRow、ContextInjectionRow 与 SystemPromptRow 接入，使折叠详情文本保留在文档中供查找与辅助技术使用，隐藏成员不再在轮次中途被清除。

## 验证

ChatView 规格覆盖实时折叠的成员集合与隐藏状态、运行中的计数与标题、标准模式直通、`turn/end` 移交、以及焦点行揭示；chat-store 规格固定空步骤条目生命周期；`pnpm run test:gui` 在客户端套件保持绿色。

## 备选方案

**每个 seat 用本地打开状态做实时折叠。** 否决：成员 seat 是独立组件实例，一次点击只会揭示被点击的成员；存储让同一轮次的所有 seat 一致，并在重挂载后存活。

**从第一个可见 chunk 起实时折叠。** 作为事实投影被否决：投影器本就按日志 seq 确定性地累积每步骤证据，从最新带回复内容的 Assistant 行推导 `liveStep` 可让搜索隐藏与流式行保持一致，无需渲染侧计时器。

**单独的运行中控制 Node 种类。** 否决；已定稿控件已拥有轮次的过程呈现，拆分生命周期会在两个渲染器之间复制成员集合逻辑。

## 后果

- 紧凑模式下打开的轮次会实时重排：证据到达时行即折叠，尾部上方的读者会看到完成折叠早已产生的同样重排。
- 运行轮次中可见的 Assistant 行永远不是折叠成员；当轮次还没有带回复内容的行时，所有证据行都折叠在控件之后。
- 收起 children 的挂载保留按 DisclosureRow 调用点逐一点名；展开体较重的行保留默认的不挂载行为。
- 投影器呈现新增 `liveStep`/`liveFoldable`；已关闭轮次发布 null/false，已完成轮次契约不变。
