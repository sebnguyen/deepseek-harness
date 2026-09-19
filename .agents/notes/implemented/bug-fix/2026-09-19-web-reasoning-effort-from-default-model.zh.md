# Web 会话应用 agent-default-model 的推理强度

DigitalOcean 等 OpenAI 兼容网关仅在客户端发送 `reasoning_effort` 时把思维链写入 `delta.reasoning_content`；否则思维内容进入 `content`，Harness 记为 assistant `text` 块，Web UI 会像正文一样展示。

`ApiSessionAgentController` 在构造 `agentOptions` 以及从缺少 effort 的 `request/header` 恢复选择时会丢掉 `reasoningEffort`。Headless 因用完整 `currentSelection()` 初始化 `installModelSelection` 而未受影响。

当已记录路由与部署默认一致且请求头未记录用户显式 effort 时（适配器默认 effort 仍排除），选择恢复会合并 `agent-default-model` 设置中的 effort；`agentOptions` 与 fork 的 `create` 也会传递设置中的 effort。
