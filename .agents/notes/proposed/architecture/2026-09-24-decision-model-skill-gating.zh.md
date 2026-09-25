# Agent Note: 由决策模型判断驱动的活跃 skill 投影

Status: proposed

[English](2026-09-24-decision-model-skill-gating.md) | 中文

## 问题

`dsh-tool-skill` 把每一个可被模型调用的 skill 发布为一份持久目录，并把 `skill` 加载工具交给模型，于是选择变成了模型自身的相关性判断。该信号在两个方向上都失败：把一个库从一组已知有效的 skill 扩展至 202 个 skill 会使通过率最多下降 21%，且大部分损失被归因于调用了错误的 skill，而非归因于扩大的上下文（[skill 遮蔽](https://arxiv.org/html/2605.24050v1)）；模型也会反向失败，即完全没有意识到需要一个专门的 skill。

目录自身的形态又加重了成本。它是最新者胜且只追加的，因此每次变化都会发布一份完整清单，而其前身仍留在提示词中并持续计入 message token。宣告某份目录“替换此前所有可用 skill 清单”的那句话是给模型的指令，而不是一次驱逐：只有 compaction 才会移除被取代的节点。

因此，harness 目前无法因为某项判断认为当前 step 需要某个 skill 而准入其正文，也没有任何东西报告当前上下文窗口已经持有哪些 skill 正文。

## 提案

目录不再是选择面。由决策模型在每个 pre-step 判断每个候选，harness 发出该判断所准入的 skill 正文。

**决策模型。** `@deepseek-ai/dsh-skill-context` 同时承担三个角色：`ctx.decision` 的 Service Definition、回答其问题的 TypeSafe JeV 求值器，以及执行准入的 Consumer。一次调用携带一份 state 与一个带类型问题的映射，返回带概率的带类型答案。三者留在同一个包内，遵循[能力接缝规则](../../implemented/architecture/2026-06-13-capability-seams.zh.md)：只有一个 provider 与一个 Consumer 的能力，在第二个出现之前保持为单个包。

**准入。** 在每个 `agent/pre-step`，门控在单个请求中为每个目录候选提出一个 Noul 问题，并准入概率越过所配置阈值者，由 top-k 设上限。

**活跃集合。** 门控用 `Session.deriveMessages()` 读取当前窗口——这是受认可的派生读取：surface 是派生历史的唯一来源，因此一次 compaction `replace` 会从派生结果中删除被遮蔽的节点，而每个 surface 节点只被投影一次。它收集 source kind 为 `skill-invocation` 的消息名称。已在该集合中的 skill 绝不会被再次发出，因此该读取在无需扫描事件日志的情况下即是 compaction 感知的。

**发出。** 被准入的 skill 成为一条持久 `user/message`，携带已发布的 `skill-invocation` source。不新增 source kind，也不改动会话格式：该 source 已经携带 `kind`、`name` 与 `form: 'instructions'`，且现有读取方已经渲染它。

**节奏。** 判断在每个 pre-step 运行，而发出仅在判断准入了一个尚不活跃的 skill 时发生。因此重复的答案不发出任何内容，这使每步调用是安全的，而不只是可负担的。

**预算。** 上下文容量来自解析后的模型路由。越过阈值但已无剩余空间的候选会被计数并上报；窗口绝不会被扩展到超出容量，该拒绝也绝不是静默的。

**退役。** 目录发布与 `skill` 工具注册均被删除。`/name` 手势仍经同一路径发出同一 source kind，因此用户发起的加载保持不变。

**配置与降级。** 阈值、top-k、provider 与启用开关都是经过校验的 `Config` 字段。provider 失败、注册表快照不完整或被拒绝的决策都不发出任何内容，并使窗口保持原样。

## 各包的变化

- `dsh-skill` 保留 Service Definition 与其注册表契约；[调用策略](../../implemented/feature/2026-07-28-skill-invocation-policy.zh.md)中面向模型的那一半不再决定任何事，因为已不存在供其把关的模型可见面。
- `dsh-skill-filesystem` 与 `dsh-skill-badge` 是未改动的 Service Provider。
- 目录与加载包变为 request-context 生产者，并迁移到 `packages/context/skill-context`，包名 `@deepseek-ai/dsh-skill-context`，因为发出模型上下文是它仅剩的角色。
- `@deepseek-ai/dsh-skill-context` 是新增包，且是唯一与决策模型端点通信的包。

## 实施计划

八个切片，每个切片都以自己的聚焦证据落地，且都不需要改动会话格式。

**1. 活跃集合读取。** 把该读取实现为对 `Session.deriveMessages()` 的纯操作，收集每一条 source kind 为 `skill-invocation` 的消息的 `name`。同步的任意位置读取器已被弃用并禁止新增调用，因此该读取经由派生投影而非解析事件序号。此时尚无消费方。测试固定：被 compaction 遮蔽的节点脱离集合、空窗口，以及同一 skill 被重复注入时收敛为一个名称。

**2. 决策接缝与 provider。** 在 Consumer 与 TypeSafe 求值器旁新增 `ctx.decision` 的 Service Definition，以 `packages/llm/llm-deepseek` 作为 provider 模板：为端点与钉住的模型标识符提供经过校验的 `Config`，有界调用超时，以及带类型的失败。单元测试驱动假求值器；只有 e2e 通道调用该端点，且无密钥时自动跳过。

**3. 开关之后的准入。** 注册消费该接缝的 pre-step 监听器，为每个新准入的 skill 发出一条 `skill-invocation` 消息，此时目录监听器与 `skill` 工具仍然挂载。测试固定：每次准入恰好一条消息、判断未变化时不发出任何内容，以及 top-k 上限。

**4. 预算与拒绝。** 从解析后的模型路由读取上下文容量，从 `dsh-token-meter` 读取当前构成，并统计每一个因空间不足而被拒绝的准入。测试固定：被拒绝的候选不发出任何内容且计数器递增。

**5. 证据。** 新增一个无密钥的会话快照，固定所发出的消息、下一个 step 上 compaction 感知的空操作，以及一份不含目录的转录；若循环可见的事件集合发生变化，则同步扩展 SDK 预期输出；并重跑目录快照以确认已发布的世代仍可重放。

**6. 退役。** 删除目录监听器、渲染/摘要/历史辅助函数、`skill` 工具定义，以及客户端中为它注册的 `tool.call.toolview`；把该包迁移到 `packages/context/skill-context`，包名 `@deepseek-ai/dsh-skill-context`，并更新其依赖方；更新四处组合点，即 `packages/bundle/base/cordis.patch.yml`、`packages/bundle/web-app/cordis.patch.yml`，以及 standard、cordis 与 ptc 三个 preset；并重写固定目录与工具的各个快照：`snapshots/web/schedule-catalog`、`snapshots/web/skill-tool-row`、`snapshots/session/skill-load`，以及每一个列出 `skill` 工具的 `tool-schemas.expected.json`。

**7. 策略。** 在 `modelInvocable` 不再为任何面把关的地方停止查阅它，保留该字段与 frontmatter 键，并以交叉链接指向[调用策略](../../implemented/feature/2026-07-28-skill-invocation-policy.zh.md)而不是删除它：这属于部分取代，因此两个 note 都保持活跃并互相链接。

**8. 文档与门禁。** 为迁移后的包、新增的 provider 与 `dsh-skill` 更新 README 与 JSDoc，写明配置、活跃集合查询、预算拒绝计数器与被移除的各个面；随后运行受影响的包测试、`typecheck`、`lint`、`test:docs`，以及受影响的各个无密钥快照。

## 代码草图

以下是切片 1 到切片 4 所依据的承重类型与监听器。签名遵循已发布的服务惯例；容量读取在切片 4 绑定它之前保持为一个接口。

**接缝。** Service Definition 拥有该 key 与该词汇，因此没有 Consumer 导入 provider 的类型，provider 也永远不会看到 harness 的提示词文本。

```ts
// packages/context/skill-context/src/decision.ts
import { Service, type Context } from '@deepseek-ai/cordis'

/** One typed question: the judgment to make about the shared state. */
export interface DecisionQuestion {
  readonly id: string
  readonly instructions: string
  /** Answer labels for a Choice question; absent for a Noul question. */
  readonly criteria?: Readonly<Record<string, string>>
}

/** A Noul answer: the probability that the instruction holds, in [0, 1]. */
export interface NoulAnswer {
  readonly kind: 'noul'
  readonly probability: number
}

/** One state evaluated against every question, in a single provider call. */
export interface DecisionRequest {
  readonly state: unknown
  readonly questions: readonly DecisionQuestion[]
}

/** Decision capability: typed questions in, typed answers out. */
export class DecisionService extends Service {
  /**
   * @param ctx - plugin context owning the `decision` key.
   */
  constructor(ctx: Context) {
    super(ctx, 'decision')
  }

  /**
   * Evaluate every question against one state.
   * @param request - the state and the questions to answer.
   * @param signal - aborts the provider call.
   * @returns one answer per question, in request order.
   */
  async evaluate(request: DecisionRequest, signal: AbortSignal): Promise<readonly NoulAnswer[]> {
    void request; void signal
    throw new Error('dsh-decision: no evaluator is registered')
  }
}
```

**provider。** 每个随部署而变的选项都是一个经过校验的 `Config` 字段，且模型标识符被钉住而非使用别名，这样版本迁移就无法静默地改变阈值。

```ts
// packages/context/skill-context/src/typesafe.ts
export interface Config {
  /** Pinned model identifier; an alias would reprice and retune without notice. */
  model: string
  /** Evaluation endpoint. */
  endpoint?: string
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  model: z.string().required(),
  endpoint: z.string().default('https://api.typesafe.ai/v1/systemone'),
  timeoutMs: z.number().default(10_000),
})

/** Noul questions are renormalized probabilities, so the id is never sent to the model. */
function toBody(request: DecisionRequest): unknown {
  return {
    model: config.model,
    state: request.state,
    questions: Object.fromEntries(
      request.questions.map(question => [question.id, { type: 'noul', instructions: question.instructions }]),
    ),
  }
}
```

**活跃集合。** 会话是唯一事实来源，而派生窗口正是读取它的地方：一次 compaction `replace` 会从派生结果中删除被遮蔽的节点，因此该读取既不需要缓存，也不需要扫描事件日志。

```ts
// packages/context/skill-context/src/live-set.ts
import type { Session } from '@deepseek-ai/dsh-session'

/**
 * Skill names whose bodies are currently in the model's window.
 * The derived-message projection is the sanctioned window read: the surface is
 * the single source of derived history, so a compaction replace deletes shadowed nodes.
 * @param session - the calling agent's session.
 * @returns names of live `skill-invocation` injections.
 */
export function liveSkillNames(session: Session): Set<string> {
  const live = new Set<string>()
  for (const message of session.deriveMessages()) {
    if (message.source.kind !== 'skill-invocation') continue
    live.add(message.source.name)
  }
  return live
}
```

**监听器。** 每个 step 一次判断，只做追加式发出；判断未变化时不发出任何内容，因此每步调用是幂等的，而不只是可负担的。

```ts
// packages/context/skill-context/src/index.ts
export const name = 'skill-context'
export const inject = ['agents', 'skills', 'decision']

ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
  const decision = await next()
  if (decision.kind === 'reject') return decision
  const snapshot = await ctx.skills.snapshot({ cwd: agent.session.header.cwd, signal, scope: agent })
  if (!snapshot.complete) return decision
  const live = liveSkillNames(agent.session)
  const pending = snapshot.skills.filter(skill => isModelInvocable(skill) && !live.has(skill.name))
  if (pending.length === 0) return decision
  let answers: readonly NoulAnswer[]
  try {
    answers = await ctx.decision.evaluate({
      state: { task: taskText(agent.session), workspace: { cwd: agent.session.header.cwd } },
      questions: pending.map(skill => ({
        id: skill.name,
        instructions: `Is this skill needed to complete the task? ${skill.description}`,
      })),
    }, signal)
  } catch (error: unknown) {
    ctx.logger.warn(`skill-context: judgment failed, window unchanged: ${String(error)}`)
    return decision
  }
  signal.throwIfAborted()
  const admitted = pending
    .filter((_, index) => (answers[index]?.probability ?? 0) > config.threshold)
    .slice(0, config.topK)
  return { ...decision, messages: [...decision.messages, ...admitted.map(skillMessage)] }
})
```

**容量读取。** 上下文容量属于解析后的路由，因此它作为一项能力而非常量进入；切片 4 把已解析模型的上下文窗口与 `ctx.tokenMeter` 绑定到它，而一个已无剩余空间却被准入的候选会被计数而不是被发出。

```ts
/** Remaining tokens this step may spend on injected skill bodies. */
interface SkillBudget {
  /**
   * @param agent - the agent whose route supplies capacity.
   * @returns tokens still available, or undefined when capacity is unknown.
   */
  remaining(agent: Agent): Promise<number | undefined>
}
```

## 考虑过的替代方案

**改写目录消息，而不是发出正文。** 否决。最新者胜语义使任何变化都成为一份完整清单，被替换的节点会在其位置付出一次缓存重预填充的代价，且该设计需要按槽位的活跃性才能知道要遮蔽哪个节点。为每个被准入的 skill 发出一条正文则只追加、不需要移除，并把工作集限制为每个曾被准入的不同 skill 各一份正文。

**保留 `skill` 加载工具。** 否决，因为它把选择留给了一个已被测量证明失败的信号，也因为一个只做建议、而仍由模型决定的决策模型无法证明自身的效用。其代价记录在风险一节：模型失去了它的恢复路径。

**在 `ctx.skills` 之外再取一个服务 key。** 否决：一个 Cordis key 只有一个所有者，第二个注册表需要自己的 provider 与查询，且既有会话在两者之间没有迁移路径。

**用 `WeakMap` 缓存活跃集合，并以 `session/event` 使其失效。** 否决，改为在每次判断时读取 `Session.deriveMessages()`。该投影已经是权威的派生窗口，并按 surface 节点逐个维护，因此缓存会成为第二份派生副本，需要针对分叉、恢复与外部替换进行对账。

**对整份目录提出一个 Choice 问题。** 否决，因为选项标签的顺序会影响答案，且准确率随选项数量增加而下降；逐候选的 Noul 问题让每个判断都保持二值。

**新增一个带版本名的后继包。** 依据[包命名规则](../../../../docs/cookbook/adding-a-package.zh.md)否决：版本后缀命名的是版本而不是角色，且本仓库的公开插件 API 处于预稳定阶段，因此契约在原地变更。

## 验收标准

- 一项活跃集合测试证明：已发出的 skill 不会被再次发出，且被 compaction 遮蔽的节点会脱离活跃集合并可再次被发出。
- 一项测试证明：未变化的判断在下一个 pre-step 不发出任何内容，而活跃集合之外的被准入 skill 恰好发出一条 `skill-invocation` 消息。
- 一项测试证明：越过阈值但已无剩余容量的候选被计数并上报，且不为它发出任何消息。
- 一项测试证明：provider 失败、快照不完整与被拒绝的决策各自都使会话消息集合保持不变。
- 一个无密钥的快照会话重放一份不含目录的转录，并仅凭派生窗口重建活跃集合，重放期间不调用决策模型。
- 各包 README 与 JSDoc 说明配置、预算拒绝行为、活跃集合查询，以及已移除的模型可见面。

## 风险

移除加载工具会使门控成为模型获得 skill 正文的唯一路径。错误的判断因此成为不可恢复的能力损失，而不只是次优的提示，这是把阈值保持保守、并让拒绝路径可观测的最强理由。

窗口只会增长。每份已发出的正文都会留存到 compaction 将其遮蔽为止，因此剩余容量单调不增，而因空间不足被拒绝的 skill 会一直保持被拒绝，除非自动 compaction 收回空间。因此该设计依赖自动 compaction 处于启用状态，且这一依赖必须被明说而不是被假定。

除非获得结果证据，该判断读到的是相关性，而相关性正是已经失败的信号。没有成对的 with/without 运行，门控可以在减少 token 的同时仍然错过模型所错过的同一批 skill。

provider 处于早期访问阶段，不公布缓存契约，并在版本之间移动其别名，因此针对某一版本调好的阈值必须钉住带版本的标识符。
