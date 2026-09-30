# Agent Note: Web 后台活动抽屉

Status: proposed

[English](2026-09-30-web-background-activity-drawer.md) | 中文

## 问题

Web 客户端把“后台正在跑什么？”分散在四个互不相通的表面上回答。transcript 里的 `run_in_background` 与 delegation 卡片只记录任务的开始，此后再也不更新。session 头部的 jobs 弹出层——即本笔记以 chip 与抽屉取代者——列出活着的 job 并提供输出尾巴，但任何外部点击都会把它关掉。头部的 subagent 目录（[dsh-client-ui-subagent](../../../../packages/client/ui-subagent/README.zh.md)）导航持久的后代树，却只显示 running/inactive 两种活动。左侧栏的 chip 只统计在跑的 subagent，对 job 只字不提。每个表面各有自己的词汇与生命周期，没有一个能把某个 agent 与该 agent 拥有的后台进程关联起来，也没有一个能在用户阅读或书写对话时保持打开：盯一次长构建，就得把一个弹出层悬在头部上。

其中两块是 [Web 后台任务展示](../../implemented/feature/2026-08-08-web-background-job-display.zh.md) 有意识推迟的：一个统一 jobs 与 agents 的表面，以及一个全宿主视图。本笔记按 session、只读地提出统一的一半；全宿主视图与人类发起的取消仍留在那篇笔记留下的位置。

## 提案

一个停靠在 composer 上方的 chip，以及一个在 composer 下方展开、把 composer 顶起的抽屉。chip 是现有 `conversation.input.dock` 列表槽位的一项，与 claim chip、goal 条、todo 面板同槽，遵循[槽位类型链](../../implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)约定。抽屉渲染在 sticky composer 栈内、输入条之下，因此打开它时整个栈以高度过渡动画上移（尊重 `prefers-reduced-motion`），transcript 的可见区域收缩，而不是抽屉盖住内容。

### chip

仅当 session 拥有至少一个后台项时 chip 才出现，延续现有 jobs 触发器的安静入口规则。它的徽标统计活着的工作——在跑的 job 加在跑的 subagent——计数为正时带一个旋转 glyph；当只剩已落定的行时计数归零，徽标随之省略。点击 chip 或按下键盘快捷键切换抽屉；chip 自身携带开/合的示能符。

### 抽屉

左栏是一棵归属树，分两节。Live 节列出 running 与 stopping 的 job，以及在跑的 subagent，按开始时间排序；owner 为后代 session 的 job 嵌套在对应 subagent 节点之下，于是 agent 的后台进程读作该 agent 的子项。Archive 节默认折叠、头部带计数，收纳已落定的 job——completed、killed、failed，且失败细节清晰可读，延续“失败 job 的 detail 是其失败唯一可读之处”的理由——以及不再活动的 subagent，按结束时间排序。一个“仅看活着”的过滤开关可整体隐藏 Archive。宿主重启后注册表镜像为空而 transcript 仍保留开始卡片，因此抽屉从该 session 的 `run_in_background` 与 delegation 卡片水合出 archive 行，并标记 state-unknown，直到活的镜像条目使其复活。

右栏渲染选中的节点。subagent 展示其状态与“作为会话打开”示能符，执行现有的精确地址导航；追加提交与独立的 Stop 仍留在完整 session 视图，按 [Web subagent 对话](../../implemented/feature/2026-07-27-web-subagent-conversations.zh.md)与[当前 turn 中断](../../implemented/feature/2026-08-06-continuable-subagent-interrupt.zh.md)的规定。job 展示其结论文本——存在时取生产方的 detail，否则取状态词——让失败 job 的失败保持可读。原始输出的终端风格尾巴随本工作旁边建设中的 job-output 通道：一旦输出帧的客户端镜像落地，详情面板获得保留的最近行、丢行提示与活着时自动下滚。键盘：ArrowUp/ArrowDown 在树中移动，Enter 选中并送入右栏，Escape 关闭抽屉并把焦点还给 chip。

### 数据流与打包

一个新的客户端包拥有 chip、抽屉与一个 `useSessionActivity` 投影：把 Session Controller 已经折叠的镜像——`jobsBySession`、`jobOutputBySession`、`subagentsByParent` 与目录活动——在已提交的镜像之上合并成一个行模型、一套状态词汇。扁平视图不需要任何新的 wire 表面；终端尾巴在第二阶段随 job-output 通道落地，而非第一阶段。归属嵌套需要一处增量：jobs 帧按已挂载的 session 推送，子会话的 job 到不了父会话的镜像；Session Controller 对抽屉已报告为可见分支的后代 session 额外推送 `jobs` 帧，复用目录现有的分支兴趣信号。在该增量落地之前，第一阶段把父会话的 jobs 平铺显示在 agent 树旁。

### 退役与范围

头部的 jobs 弹出层随本表面一起退役：它的行约定、状态标记与时长词汇迁入抽屉，[background job list 场景](../../implemented/feature/2026-08-08-web-background-job-display.zh.md) 在同一改动里按 chip 与抽屉重写。头部的 subagent 目录触发器在第一阶段保留，等抽屉树获得目录的约定后再退役：遍历的机械重复很便宜，但目录带懒展开分支的加载，以及随目录交付的 `conversation.composer` 只读选举，才是迁移的真实成本；推迟它们让抽屉的第一阶段在构造上保持只读。左侧栏的 running-subagent chip 保留：它回答“哪个 session 在忙”，与“这个 session 在跑什么”是不同的问题。transcript 卡片本提案不动；给它们加活的 status chip 是后续增强。抽屉只读：里面没有 kill、没有 stop、没有追加；subagent 行提供“作为会话打开”，经现有的精确地址导航路由，完整 composer 仍是追加的座位。范围按 session；全宿主活动视图仍按 2026-08-08 笔记所述，推迟在注册表 per-owner 授权围栏之后。

分阶段：P1 交付 chip 与带扁平树的抽屉——父会话的 job 加上来自目录镜像的直接 subagent 子项——结论详情、仅看活着的过滤、以及 jobs 弹出层的退役。P2 交付经 job-output 通道的终端输出尾巴、嵌入式 subagent transcript、接管目录键盘约定的抽屉树懒展开后代加载、以及启用嵌套的后代 jobs 帧。P3 可选，是动作（带对模型可见中断决策的人类 kill、subagent 结局），行即控件的结构为其留好空间，无需重新设计。

## 考虑过的替代方案

**右栏 Activity 标签页。** dockkit 右栏的常驻标签页能复用现有标签注册表，但右栏是文档查看器的座位：一边聊天一边盯活动要付出标签切换的代价，且与文件、预览共抢一个面板。抽屉把活动留在输入条旁——注意力每发一条消息都会回到这里——并延续 claim chip 已经立下的 input dock 先例。

**dockkit 第二边缘的真底部 dock。** VS Code 终端式抽屉（在 transcript 下方）与 composer 栈抽屉几何相同，但要新建一个 dock 边缘；composer 栈本来就 sticky 在地面，让它在输入条之下向下生长，用现成机制达到同样布局。

**一个统一的弹出层代替抽屉。** 造价最低，但弹出层天性瞬时——外部点击即关，不能保持在对话旁常开，而这正是本笔记要回答的核心抱怨。

**把 jobs 折进 subagent 目录。** 2026-08-08 笔记否决过它：目录是带懒展开分支、时长与 token 约定的持久 session 谱系树，而进程作用域的 job 是第二个数据模型。该分析对目录组件仍然成立；抽屉改为在客户端投影层合并两个镜像，两个源模型各自不动。

**全宿主活动中心。** 注册表的授权围栏按 owner session；全局列表需要新的访问规则，也需要 session 头部之外的家。按 2026-08-08 笔记，推迟而非封死。

## 验收标准

- 一条无 key 的 Web e2e，扩展现有的 background-job-list 场景：一次真实 `run_in_background` 调用使 chip 无需用户交互即出现并带活计数；打开抽屉顶起 composer；Live 行走秒；选中活行呈现其状态；通过注册表 kill 该 job 后，行带着可读的失败细节落入 Archive。
- 一个在跑的一次性后台 subagent 在 Live 下出现一次；P2 之后它拥有的 job 嵌套在其节点之下，嵌入 transcript 在其运行时持续流入，抽屉树接管目录的键盘约定并取代头部触发器，只读 composer 不受影响。
- 头部 jobs 触发器在交付抽屉的同一改动里消失；头部目录触发器随 P2 树退役。

## 风险

- 抽屉与 transcript 在矮视口上争抢纵向空间。抽屉高度以视口比例为上限，一次 Escape 即关闭，保证 transcript 可用。
- 抽屉内嵌入第二个 transcript 渲染器，两者同屏时对话渲染成本翻倍。详情面板一次只挂一个子 session，并复用现有虚拟化 trajectory 渲染器，成本有界。
- 后代 jobs 帧扩大控制流。帧仍按 session 整体快照，且仅对抽屉已报告可见的分支推送，抽屉闲置时零成本。
- 目录退役后，其键盘树在抽屉树交付前缺席。验收标准要求方向键约定随 P1 交付，而非 P2。
- 水合出的重启后行可能被当作活的事实来读。state-unknown 标记点名的正是这一点。
