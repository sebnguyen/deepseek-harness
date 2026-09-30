# Agent Note: Workspace file reads follow symbolic links

Status: implemented

[English](2026-09-28-workspace-file-symlink-follow.md) | 中文

## Problem

[工作区文件服务](2026-09-05-workspace-files-service.zh.md)用 `lstat` 探测请求路径，并拒绝任何末端为符号链接的组件，无论它指向何处。[读取权限决策](2026-09-09-workspace-file-read-authority.zh.md)随后让 `read`、`readBytes`、`readAll`、`readRelated` 与 `stat` 继承 Session 文件系统后端的读取权限，因此工作区外的绝对路径或 `..` 路径变得可读，而指向同一外部文件的链接却仍被拒绝。限制文件读取已不再是该拒绝所做的事。

在 Web 客户端上，该拒绝还与目录树相矛盾。`list` 把链接子项报告为其解析后的类型，因此指向普通文件的链接在树中会被画成一行可正常打开的普通文件；打开它以 `workspace-file/not-regular-file` 失败，预览则用 `Not a regular file, nothing to display.` 取代内容。仓库里这类链接司空见惯——`AGENTS.md` 旁边的 `CLAUDE.md` 就是最常见的一种——于是读者从树里选中的文件，恰恰是读者打不开的文件。

## Decision

每项操作都通过组合文件系统解析请求路径并跟随其末端组件，随后要求解析后的目标是该方法所需的类型。文件方法以 `workspace-file/not-regular-file` 拒绝目录或任何其他非普通文件目标；`list` 以 `workspace-file/not-directory` 拒绝非目录。目标不存在的链接解析不到任何条目，属于 `workspace-file/not-found`。

`list` 随后对解析后的目标执行其工作区包含检查，因此通过链接进入 Session 工作区内的目录会被列举，而目标位于根之外的链接为 `workspace-file/outside-workspace`。目录导航仍留在工作区内；文件读取保留后端的读取权限，与直接给出同一目标的显式路径完全一致。

结果的 `absolutePath` 保持规范化——即目标在文件系统执行环境中的路径——因此链接与其目标共享同一个标识和同一个变更订阅绑定，链接的预览跟随目标的版本。

`dsh-fs` 保留 `lstat` 作为其不跟随链接的探测原语，供规则确实针对路径条目本身的消费方使用。`tool-present` 用它拒绝模型交付声明中的末端符号链接；`ui-deliverables` 的原生打开路由把交付路径交给 Host 桌面，因此在解析或打开之前也以同样方式检查。两处拒绝都保持不变。工作区文件的错误 details 去掉已不可达的 `symlink` 类型，因为 `FsInfo` 只报告 `file`、`directory` 或 `other`：`workspace-file/not-regular-file` 携带 `directory` 或 `other`，`workspace-file/not-directory` 携带 `file` 或 `other`。

## Alternatives considered

**保留该拒绝，并在树中把链接行标记为不可打开。** 树中的 `other` 行已经渲染为灰显、不可聚焦并带提示的条目，但指向普通文件的链接抵达客户端时是 `file`，因此这条路线需要 `list` 报告链接本身而不是其目标——也就是线上新增一种条目类型。它仍然拒绝预览读者选中的文件，而这正是本次要修复的缺陷；同时，当初促成该拒绝的包含理由已不再覆盖文件读取。

**仅在目标位于工作区内时跟随链接。** 这会把服务已刻意放弃的包含规则重新施加到文件读取上，并会继续拒绝指向根外共享文件的链接——例如某个仓库的 `AGENTS.md` 链接到别处的检出目录——而对同一目标使用绝对路径却是允许的。

**文件方法跟随链接，但让 `list` 继续拒绝。** 树仍然无法展开链接目录，同样的可见瑕疵只是下移一行；而对解析后目录的包含检查正是让 `list` 跟随变得安全的原因。

**让原生打开路由也像服务现在这样跟随链接。** 否决：该路由把路径交给 Host 桌面，由本机自己的应用打开，因此放在声明路径上的链接会打开 Session 从未声明的文件。它改为自带路径条目检查。

**在 `stat` 之前保留 `lstat` 作为存在性探测。** 一旦类型判定归属于解析后的目标，第二次探测就没有了归属：它让每次读取多付一次文件系统调用，而其唯一残余效果只是把探测之后的竞态报告为 `workspace-file/not-found` 或 `workspace-file/not-regular-file`，而不是后端自身的 `FS_NOT_FOUND` 或 `FS_NOT_REGULAR_FILE`。

## Consequences

通过符号链接抵达的文件或目录在 Web 客户端中与其他文件一样打开，包括 `AGENTS.md` 旁边的 `CLAUDE.md` 这类情形；部署放在目标前面的链接也无需为了这一点重构目录树。

在服务的唯一一次 stat 与后端的读取之间消失或改变类型的文件，现在暴露后端的 `FS_NOT_FOUND` 或 `FS_NOT_REGULAR_FILE`，而不是 `workspace-file/*` 代码；客户端的通用失败行会带上其消息。

通过链接的目录列举由解析后的包含关系界定，而不是由路径写法界定，因此离开工作区的链接报告 `outside-workspace`，树也始终只提供工作区内的内容。文件读取没有获得任何新权限：链接解析到的目标，后端本来也可以按显式路径读取。

不得跟随链接的消费方保留自己的检查。由[交付决策](../feature/2026-09-08-present-workspace-source-files.zh.md)负责的 `ui-deliverables` 原生打开路由承担了服务不再执行的路径条目检查，因此被替换为链接的交付文件会以 404 被拒绝，Host 桌面永远不会被要求打开其目标。

## Testing

`packages/api/workspace-files/tests/read.spec.ts` 固定了读取指向工作区内文件的链接、读取目标在工作区外的链接，以及把悬空链接报告为 `not-found`，并与单次探测的竞态用例并列。`read-all.spec.ts` 固定 `readRelated` 跟随链接；`stat.spec.ts` 固定链接报告其目标的标识、悬空链接为 `not-found`；`list.spec.ts` 固定列举工作区内的链接目录，以及目标离开工作区的链接为 `outside-workspace`。`ui-sidebar-files` 与 `ui-sidebar-documentpreview` 的文件树和预览 spec 覆盖失败码的客户端一侧，而失败码本身未变。`packages/client/ui-deliverables/tests/present-open.host.spec.ts` 固定原生打开路由拒绝末端链接，并且仍能打开工作区外的普通文件。
