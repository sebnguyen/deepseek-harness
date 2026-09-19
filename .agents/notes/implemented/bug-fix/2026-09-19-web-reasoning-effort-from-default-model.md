# Web sessions apply agent-default-model reasoning effort

OpenAI-compatible gateways such as DigitalOcean inference put chain-of-thought in `delta.reasoning_content` only when the client sends `reasoning_effort`. Without it, the provider streams thinking in `content`, which the harness logs as assistant `text` blocks and the Web UI renders as the answer.

`ApiSessionAgentController` dropped `reasoningEffort` when building `agentOptions` and when restoring selection from a logged `request/header` that omitted effort. Headless avoided the gap by seeding `installModelSelection` from the full `currentSelection()`.

Selection restoration now merges deployment `agent-default-model` effort when the logged route matches and the header recorded no explicit user effort (adapter-defaulted effort stays excluded). `agentOptions` and fork `create` pass through settings effort.
