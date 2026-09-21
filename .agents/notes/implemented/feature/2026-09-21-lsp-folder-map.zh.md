# LSP 文件夹地图（`symbols`）与 map 接缝操作

状态：已实现

## 问题

按位置作用的 `lsp` 导航无法提供文件夹级结构：缺少批量 `documentSymbol` 大纲与调用层次计数，难以在 read 循环前做发现。

## 决策

通过 `lsp-stdio` 翻译扩展 LSP 能力，加入 map 操作（`documentSymbols`、`callers`、`callees`）；在 `tool-lsp` 上增加 `callers`/`callees`；交付 `@deepseek-ai/dsh-tool-lsp-map` 的 `symbols` 工具，将每文件大纲批处理为 ASCII、路径锚定行，可选一跳 `in:`/`out:` 计数与级联上限。在固定 LSP 段之后注册 `TOOL_LSP_MAP` 系统提示词指导。`tool-lsp-map` 在挂载 `glob`、`lsp` 与 `read` 时还会在 `TOOL_DISCOVERY`（tool-batching 之后）注册 `tool:discovery`，说明 glob → symbols → callers/callees → read 流程。

## 后果

文件夹地图依赖声明了 `documentSymbolProvider`（热点还需 call hierarchy）的语言服务器。精确调用边仍在 `tool-lsp`；`symbols` 仅计数，除非模型再用懒加载的 caller/callee 查询跟进。
