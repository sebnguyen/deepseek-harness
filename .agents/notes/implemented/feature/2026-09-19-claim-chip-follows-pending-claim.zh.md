# Agent Note：Claim 芯片跟随 Session 待决声明，而非所属轮次

状态：已实现

## 问题

Web GUI 的 claim 芯片通过匹配账本中 `turn` 等于所属 Turn 位置的条目来展示每轮声明。这把芯片绑在 UI 未必能稳定解析的轮次身份上——当前轮声明的 claim 在消息/轮次映射不一致时可能不出现——且已裁定结论分散在各已完成轮次上。

## 决策

`dsh-client-ui-claim` 中的 `ClaimAction` 不再按轮次选取 claim。它读取 `claim` projection，渲染 Session **当前待决声明**（`settlement.kind === 'pending'`)，与哪一轮声明无关；无待决声明时不渲染。Session 运行期间，同一待决声明出现在每一轮 assistant 操作行，并在 `ClaimDock` 中显示于输入框上方。`passed`、`blocked`、`tampered` 等裁定态仍由导出的 `ClaimChip` 供直接渲染；操作行不再展示已裁定结论。

## 曾考虑的替代方案

- **无待决声明时回退到所属轮次的已裁定 claim。** 未采用：为已裁定情形保留按轮匹配路径，会重新引入本变更要消除的轮次耦合，且已裁定芯片是否出现取决于渲染了多少轮。

## 后果

待决声明在作业进行中始终可见，不依赖轮次与消息簿记。代价是已裁定结论不再留在聊天界面——失败或被篡改的声明仍留在 session 日志与 claim 工具中，但已完成轮次的操作行不再展示。
