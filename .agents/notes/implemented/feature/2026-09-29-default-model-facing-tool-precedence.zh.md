# Agent Note: Default model-facing tool precedence

Status: implemented

## Problem

工具 schema 数组是模型唯一能读到顺序的地方，而 `dsh-system-prompt` 按名称字典序排列它。这使 `bash` 排在第三，`write` 排在最后，位于 `workflow` 之后，于是请求中唯一的顺序信号反而偏向 shell，而不是改变工作区的那些工具。

部署方本已可以设置 `toolOrder`，但没有任何随附 bundle 或 preset 这样做，而且 bundle 层级的清单无法在随附的各作用域中都成立。`orderTools` 会拒绝组装作用域不认识的已列名称，而随附作用域中确有完全没有文件工具的 agent：`minimal` agent preset 只组合持久 shell，`mode: 'ptc'` 只向作用域贡献 `run_code`（见 [PTC mode](2026-06-15-ptc.md)）。另外 patch 会替换目标行的整个 `config`，因此加在 `dsh-base` 上的清单无法在重述 `system-prompt` 行的各模式 bundle 中存留。

## Decision

未配置 `toolOrder` 时，`dsh-system-prompt` 按单一优先顺序排列面向模型的 schema：先是 `write`、`edit`、`read`，然后是 shell 族，最后是其余全部工具按字典序。

`bash` 与 `pwsh` 共享同一个名次——一次性 shell 与持久 shell 工具都使用这两个名称——因此组合无需平台分支，shell 在所有受支持平台上都占据同一位置。已配置的 `toolOrder` 会整体替换该规则，其其余项仍按字典序插入未列出的工具。

该默认值只做排序，从不拒绝。缺少某个已排名工具的作用域只是没有这个工具，因此同一顺序在完整宿主目录、`minimal` preset 以及 `mode: 'ptc'` 下都成立——在后者中该规则不产生实际作用，因为只贡献了 `run_code`。

## Alternatives considered

**把 `toolOrder` 清单放进随附的 bundle 与 preset。** 这本是首选，因为顺序是一种产品立场，放在配置里可以让它游离于代码之外。它在作用域覆盖上失败：抓住拼错工具名的校验，同时也是让单一清单无法随附的校验。`web` profile 禁用了每一行宿主工具行，改为按 agent preset 挂载工具；`minimal` preset 不组合任何文件工具；`DSH_TOOLS_MODE=ptc` 使目录中只剩下 `run_code`；而每个模式 bundle 都会重述 `system-prompt` 行。列出 `write` 的清单会在这些作用域中拒绝每一次组装。

**放宽 `orderTools`，把已列但缺失的名称当作正常缺失，然后把清单放进配置。** 这会让配置路线可行，也是第二个候选方案。它丢掉了把拼错的工具名变成组装期失败的那项检查，而 `knownNames` 之所以与可见集合分开跟踪，原因正在于此；代码默认值则让 `toolOrder` 中的拼写错误仍然显式失败。

**把 `bash` 与 `pwsh` 排成两个不同位置。** 这更贴近最初要求的清单。它失败的原因是：未排名的 shell 会退回到与无关工具一起的字典序，使 shell 的位置随组合挂载了哪些工具而变化；而按平台分支的清单会往一个本来没有平台探测的包里加入平台探测。

**只在未挂载 shell 的地方改变顺序。** 范围更窄，但会让 `web` 与 `headless` profile——也就是产生所报告行为的那两个表层——继续沿用字典序默认值。

## Consequences

模型在每个随附 profile 与 agent preset 上都先读到改变工作区的工具，紧接着读到 shell，任何部署都无需改变其组合。

顺序保持确定且与区域设置无关：已排名名称按名次比较，名次相同则按代码单元比较，因此同一工具集合的两次组装会产生完全相同的文本。

`toolOrder` 仍是唯一的覆盖手段，且是整体替换。想要别的顺序的部署要写出完整序列，而不是微调优先顺序，这让规则保持一条，而不是在默认值与部分清单之间做合并。

该优先顺序是代码中的产品立场，而不是经过校验的 `Config` 字段。它之所以固定，原因与原先的字典序默认值相同：没有任何部署因素会让它变化，而想要定制顺序的部署有 `toolOrder` 可用。

排序只是若干信号之一，其本身并不能让模型调用 `write`。用 shell 探索的 agent 不会记录任何文件系统观察，因此对已存在文件的 `write` 会被拒绝，并返回 `cannot modify "<path>": file has not been read — read the file, then retry`；`write` 的描述里也写有同样的先读规则。

## Testing

`packages/core/system-prompt/tests/tool-order.spec.ts` 固定了默认优先顺序、shell 族的共享名次，以及已配置 `toolOrder` 的其余项仍按字典序插入未列出工具。录制会话语料在 `tool-schemas.expected.json` 伴随文件中按 profile 固定组装后的序列，`pnpm run test:snapshot:refresh` 可在无 key 的情况下重新生成它们。
