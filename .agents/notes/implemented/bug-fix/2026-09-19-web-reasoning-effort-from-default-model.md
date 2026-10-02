# Agent Note: Web sessions apply agent-default-model reasoning effort

Status: implemented

## Problem

OpenAI-compatible gateways such as DigitalOcean inference put chain-of-thought in `delta.reasoning_content` only when the client sends `reasoning_effort`. Without it, the provider streams thinking in `content`, which the harness logs as assistant `text` blocks and the Web UI renders as the answer. `ApiSessionAgentController` dropped `reasoningEffort` when building `agentOptions` and when restoring selection from a logged `request/header` that omitted effort, while headless avoided the gap by seeding `installModelSelection` from the full `currentSelection()`.

## Decision

Selection restoration merges deployment `agent-default-model` effort when the logged route matches and the header recorded no explicit user effort (adapter-defaulted effort stays excluded). `agentOptions` and fork `create` pass through settings effort.

## Alternatives considered

**Web sessions require an explicit per-session effort setting.** Lost: every Web deployment on an effort-gated gateway would render reasoning as the answer until a user found the setting, reproducing the exact bug for a setting the deployment already declares.

**Adapter infers effort from the provider or model name.** Lost: effort policy is a deployment choice owned by settings; guessing it inside a provider would silently send non-default effort for routes the operator never configured.

## Consequences

Web sessions on effort-gated routes stream reasoning in `reasoning_content` exactly as headless sessions do; an explicitly logged user effort still wins over the deployment default on restore, and forked sessions inherit the resolved effort.
