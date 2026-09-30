# Agent Note: 右侧 Sidebar 默认打开并携带常驻资源管理器列

Status: implemented

[English](2026-09-30-sidebar-default-open-explorer.md) | 中文

## 问题

右侧 Sidebar 以往折叠在会话 header 按钮之后，而文件树只存在于 `files` 页 tab 里。因此每次会话想看工作区的文件都要两个手势——先展开面板，再打开 Files——而且从树上打开的文件只会在树自身还开着的时候与它并排：树打开的文件 tab 与打开它的导航器互相挤占。折叠默认还意味着面板内容在用户发现 header 按钮之前完全不可见。

## 决策

会话的停靠面以展开且默认页在座的状态开始；面板只要显示，就在左缘、停靠格旁边画一列常驻的资源管理器。`ui-sidebar-files` 拥有这一列。

- `createSurface(seed)` 在套件的初始状态上展开并用 settle 播种默认页，全部发生在任何历史之前：播种是初始状态的一部分，而不是被记录的意图，因此 undo 不会退到一个空的列，也不需要一次「首次展开」才能看见内容。刷新因此让每个会话以打开在默认页的状态回来。
- 默认页恒为引导页，与已注册的引导入口数无关。资源管理器列接手了单入口快捷规则曾经直接打开的树，因此被清空的格回到引导页的总览，而不是第二棵树；`defaultSeed` 不再数入口。
- `sidebar.right.explorer`（single，会话作用域）由 `rightbar.session` 席位声明，并在面板正文里渲染；没有注册者时出口保持为空，停靠格占满面板宽度，因此这一列既是扩展点，也是随包树的家。`ui-sidebar-files` 把自己的 `ExplorerBody` 注册在那里，与该类型的树共用同一份存储，但按 session id 而非 tab id 分桶——存储的 `byTab` 映射变为 `TreeKey` 的 `byTree`——它的文件行经 `ctx.sidebarRight.openResource` 打开到停靠格里；Files tab 保留按 tab 分桶的桶、并经自己的格打开；两处画 `Tree.tsx` 共享的行。

## 备选方案

**把 Files 页作为默认播种的 tab。** 旧的单入口规则正是这么做的；它让树成为第一个 tab，但树仍是一个 tab——打开的文件照样替换或挤占导航器，即上面说的那个缺口。

**打开文件时自动分栏一格。** 给每次打开文件都背一套布局机制，而且得到的格仍可关闭，树还是会消失。

**每次打开资源时自动补开 Files。** 在 `openContent` 里撒条件式的 `openContent('files')` 会把导航控制器与某一种 tab 类型耦合。列让 `ui-sidebar-right` 对里面住的是什么保持无知——经由一个席位。

## 后果

- 折叠纯粹成为用户手势；header 的展开按钮只在用户折叠之后存在。seat、service、store 与随包 e2e spec 都改为断言打开的初始状态，并重新对齐基线（含 document-preview 的 golden）。
- Files 页类型、引导入口与它的键控席位保留，注册形态不变；该 tab 现在是一棵常驻在停靠格旁的树的可选第二视图。
- `sidebar.right.explorer` 给面板带来第五个席位；类型侧的包为列的 opener 注入 `sidebarRight`，这是 `ui-sidebar-files` 对 `ui-sidebar-right` 的第一条值边（模块图意义上仅为信息边）。
- Undo 历史从播种之后开始，与「历史从用户的第一个意图开始」一致；关闭停靠面最后一个 tab 仍会收起并清空整列，下次展开重新播种。
