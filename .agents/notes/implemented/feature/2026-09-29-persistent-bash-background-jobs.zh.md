# Agent Note: 持久化 bash 后台任务

Status: implemented

[English](2026-09-29-persistent-bash-background-jobs.md) | 中文

## 问题

持久化 `bash` 工具把每条命令都串行地经过每个 agent 一个的 PTY，并在单命令截止时间关闭该 shell。一条长时间构建因此只有两个坏结局：之后每一次 `bash` 调用都排在它后面，或者截止时间触发、工作连同 shell 一起被销毁。一次性 `tool-bash` 在管道之上提供 `run_in_background`，但持久化工具——这个以 shell 状态为全部意义的工具——没有进入 `ctx.jobs` 运行时的路径，而后者已经拥有完成通知、快照式输出读取和 Web 任务界面。

## 决策

`dsh-tool-bash-persistent` 注册 `run_in_background`（配置 `enableRunInBackground`，默认 `true`）。后台调用：

- 通过 `ctx.terminals.spawn` 在**自己的 PTY 会话**中启动包装后的命令，而不是 agent 的持久化 shell，因此该命令既不继承也不打扰 agent 的 shell 状态，下一次 `bash` 调用也绝不会排在它后面——该调用刻意在每所有者命令队列之外运行；
- 以 `bash` 种类注册到 `ctx.jobs` 并立即返回 `started background job <id>`，与一次性工具发出的确认文本相同，消费方无法区分两个生产方；
- 从 terminal 回滚缓冲读取输出——它按行寻址且幂等——而不是从破坏性的增量游标读取，并在完成时保留最终的去标记文本，使得在会话释放之后才到达的 `job_output` 读取仍然能取到命令的输出；
- 从前台路径使用的同一组 START/END 标记解析完成，非零退出码映射为带 `exit code: N` 详情的 `completed`，与一次性生产方的结果映射完全一致。

生产方在任务完成时释放后台会话。完成通知通过既有的 `ctx.jobs.onJobDone` 监听器送达 agent——忙碌时进入下一步收件箱，空闲时唤醒——因此没有新增任何回调机制。

### 包事实

`@deepseek-ai/dsh-jobs` 是 `ctx.jobs` 类型合并所需的 peer 依赖，`packages/shell/tool-bash-persistent/tsconfig.json` 引用 `../../jobs/jobs`；`dsh-jobs-local` 与 `dsh-tool-jobs` 是真实组合 spec 所需的 dev 依赖。

## 备选方案

- **在 agent 的持久化 shell 中运行后台命令并使其退役。** 更接近预期的提升设计——截止时间或竞争把 agent 自己的 shell 变成任务。本次改动拒绝它，因为它会在一次普通的 `run_in_background` 调用上静默重置 agent 的 cwd 与环境，而且它需要尚不存在的 `retire` 所有权转移操作；专用会话让本次调用的语义保持可解释，并把提升留给独立的一层。
- **复用一次性 `tool-bash` 的生产方。** 它在管道之上按调用使用全新 shell，并携带持久化工具未挂载的沙箱升级机制。拒绝它是为了让持久化工具的 `bash` 名字背后只有一条执行路径。

## 后果

后台命令不继承 agent 的 shell 状态，工具的参数描述已说明这一点。输出通过生产方的保留缓冲在完成时的会话释放之后继续存在，其上界是最后一次刷新时的 terminal 回滚；回滚窗口滑动时重新锚定，而不是重放已消费的文本。从一次性 bash 换到持久化 bash 的已交付 `standard` preset 保持了 preset 平面到宿主注册表的连接：`apps/web/tests/shipped-composition.e2e.ts` 中的后台场景未经修改即通过。

配套改动：[把运行中的命令提升为任务](2026-09-29-promoting-a-running-command-to-a-job.zh.md) 把仍在运行的前台命令交给同一套任务机制，[有界的 job_output 等待](2026-09-30-bounded-job-output-wait.zh.md) 则把每次阻塞的 `job_output` 读取限定在界限内，会话内通知仍是超时读取的完成信号。

## 验证

`packages/shell/tool-bash-persistent/tests/background.spec.ts` 启动真实 Loader 组合（terminal-bash、subprocess-local、jobs-local、tool-jobs），证明确认文本、`job_list` 可见性、完成后的 `job_output` 读取，以及 agent 的 shell 在后台调用期间保留其导出状态。`apps/web/tests/shipped-composition.e2e.ts` 钉住已交付 preset 的连接。

## 相关

持久化 shell 本身，以及它刻意推迟的交互式 terminal 范围，属于[持久化 PTY 会话](2026-07-16-persistent-pty-sessions.zh.md)。完成通知、快照式读取与 Web 任务界面属于 `packages/jobs`。
