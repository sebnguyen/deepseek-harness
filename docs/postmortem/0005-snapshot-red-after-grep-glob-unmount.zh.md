# Post-mortem 0005：卸载 glob/grep 后未重新录制导致 `test:snapshot` 变红

[English](0005-snapshot-red-after-grep-glob-unmount.md) | 中文

Status: open

## 执行摘要

`feat/structure-your-search` 合并从 `base` bundle 卸载了 `tool-fs-search`（glob、grep），而 `sdk`、`headless`、`acp` 三个 profile 都包含 `base`。这是一项模型可见变更，因此这三个 profile 的免密钥录制会话快照不再匹配重放后的组合：`pnpm run test:snapshot` 在 133 个重放中失败 29 个。这些 fixture 是手工改写的而非重新录制，而重新录制需要 `DEEPSEEK_API_KEY`，合并环境并不具备该 key。合并已在 `test:snapshot` 变红的状态下推送到 `master`，等待重新录制。

## 概述

`test:snapshot` 以免密钥方式通过已发布 profile 重放录制的会话，并把重放转录与提交的 fixture（`session.v3.jsonl`、`writer.expected.jsonl`，以及 `system-prompt` / `tool-schemas` 预期输出）比对。此次卸载从 `packages/bundle/base/cordis.patch.yml` 以及 standard、cordis、ptc 三个 agent preset 移除了 `tool-fs-search`，因此所有基于 `base` 的 profile 都少了两个工具。

特性分支手工改写了 `.expected.md` / `.expected.json` 里的工具 schema 与 system prompt 文件以去掉 glob 和 grep，但没有重新录制生成这些文件的会话。于是重放重建出的组合与录制 fixture 描述的内容不一致，最直观的是 `session-query-spill`——它的重放复现了一次 shell `[exit code: 1]`，而预期是 `SPILL_CANONICAL_OK`。

## 影响

- 在 `snapshots/sdk`、`snapshots/session`、`snapshots/acp` 中共有 133 个快照测试里的 29 个失败。
- `test:snapshot` 是录制会话的验收门禁，因此在用 `DEEPSEEK_API_KEY` 重新录制（`pnpm run test:snapshot:record`）之前，`master` 一直是红的。
- 单元、typecheck、lint、依赖、目录等门禁仍然通过，因此红色仅局限于重放 fixture。

## 时间线

- 该特性在 `dsh-structure-search` worktree 中以未提交状态开发：`core/system-prompt` 的源码改动、base 与 preset 补丁，以及对快照 fixture 的手工改写。
- `09e006e847` 把该工作树提交到 `feat/structure-your-search`。
- `b055fc6fd9` 把它合并进 `master`；55 个快照文件自动合并，一处冲突按特性一侧的 guidance 文本解决。
- 随后 `pnpm run test:snapshot` 失败 29 个重放，且环境中没有 `DEEPSEEK_API_KEY` 可供重新录制。

## 根因

本应拦下这次事故的安全网恰是录制会话快照门禁本身，而它也的确抓到了失败；真正遗漏的是：在没有重新录制的情况下落地上一条模型可见的工具移除。schema 或 system-prompt fixture 不等同于重放转录：把 `.expected` 文本里的 glob、grep 删掉，既不会改变 `test:snapshot` 所重放的 `session.v3.jsonl`，也不会重新运行它所重放的 agent。让门禁变绿的唯一路径是 `test:snapshot:record`，而它需要的是合并环境里缺失的 API key。

## 新增防线

- 在包含任何模型可见工具或 profile 变更的同一改动中重新录制会话快照（`pnpm run test:snapshot:record`）；不要以手工改写 `session.v3.jsonl` 或 `writer.expected.jsonl` 作为替代。
- 合并任何改动 `packages/bundle/*/cordis.patch.yml` 或已发布 profile 工具面的分支之前，先在本地跑 `test:snapshot`。
- 本文档即是对这一有意识保持红色门禁的持久解释，避免后来者重新推导原因。

## 经验教训

- 改写一个录制 fixture 与重新录制它是两回事；只有重新录制才会重新生成重放转录。
- 免密钥重放门禁是对已发布组合的语义检查，而不是对 fixture 文件的格式检查。
- 把一个未提交的 worktree 整体合并，会一并继承该项工作未完成的验证状态；发布前应当运行该改动所针对的验收门禁。
