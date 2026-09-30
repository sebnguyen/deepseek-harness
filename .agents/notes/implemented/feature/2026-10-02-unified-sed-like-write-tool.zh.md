---
status: implemented
kind: feature
date: 2026-10-02
title: 单一 sed 风格 write 工具取代 write+edit
owners: packages/fs/tool-fs
---

# 单一 sed 风格 write 工具取代 write+edit

模型侧变更面收敛为单一 `write` 工具：`edits` 数组承载 sed 风格条目（字面量、JavaScript 正则、闭区间行范围、行后插入），与整文件 `content` 臂共存；`overwrite` 是显式覆盖标志，`dry_run` 是预览。独立的 `edit` 工具、`TOOL_EDIT` 指导槽位与 `fs/edit-intent` 事件退役；`fs/write-intent` waterfall 增加 `'content' | 'program'` 模式参数，使加载的 `fs-observation-policy` 能对程序施加严格的先读后改口味，同时 content 臂保持历史的创建/替换语义。

## 为什么工具拥有默认 gate

用户要求 CLI 手感：拒绝必须显式且可操作，而非记忆测试。工具自有 `gate.ts` 像策略插件一样记录 `fs/observed` 状态，并提供 waterfall 默认：已观察存在按观察版本提交；已观察缺失走创建（程序无物可补时 `FS_NOT_FOUND`）；未观察的内容写入需要 `overwrite: true`（否则 `FS_OVERWRITE_DENIED`）；未观察的程序以新鲜 stat 基修补——匹配并保持，绝不盲目覆盖。提供方的按目标锁与暂存发布仍是提交引擎；程序折叠为一次 `writeText` 调用，批次因此是一次原子 CAS 事务，all-or-nothing 由提交前抛出保证。

## 为什么没有 sed 文本解析器

条目是结构化 JSON；仓库 schema DSL 的闭包 oneOf 分支在 `execute` 前强制四种字段元组；JavaScript 的 RegExp 就是正则引擎。sed 方言的文本解析器会引入引号与可移植性层（GNU/BSD 差异、shell 嵌套），而没有自有代码需要它；`program.ts` 中四种形态的折叠是唯一新机器，且无 I/O。

## 同一变更吸收的迁移面

删除 `edit.ts`；`str_replace_editor` 按新 write-intent 参数数分派；base bundle 移除 `fs-observation-policy`（该包保留为可选严格口味，README 已说明）；system-prompt 退役 `TOOL_EDIT` 并顺移 `TOOL_GLOB`/`TOOL_GREP`；快照 sidecar 与生成目录（tool-catalog、cordis surface、doc graphs）已重新生成；README 与子系统文档双语改述并重录配对哈希。键控的 `test:snapshot:record` 仍是后续工作：凡录制到的模型可见正文嵌入旧文案处。
