# Agent Note: Tool-bound prompt guidance

Status: implemented

## Problem

Every tool-usage policy shipped as an unconditionally registered prompt section, so a composition always paid for (and the model always read) guidance for tools that could be absent: `tool-jobs` job bookkeeping, the goal/claim/workflow/ralph routing rules, and the Web deliverables formatting hint all rendered in scopes that never register those tools. `web_search`/`web_fetch` guidance additionally deviated from the shared `Advice:` style, and `dsh web` bolted deployment-specific orientation (`harness:source`, `app:web-surface`) onto the global prompt of every Web session regardless of the task, growing the request prefix with checkout paths and GUI update-contract prose the model can re-derive from the working directory and the running server.

## Decision

**Tool-usage sections bind to tool presence.** Every `tool:*` and tool-policy prompt section resolves its text through `ctx.tools.get(name, scope)` and returns `''` while the tool is hidden in the assembly scope, matching the file-reference sections. `dsh-tool-goal`, `dsh-tool-claim` (demand section and the turn-boundary reminder), `dsh-tool-workflow`, and `dsh-tool-ralph` therefore stop paying prompt bytes in tool-less scopes and in PTC scopes where a capability filter hides the tool.

**The jobs and Web-surface sections are removed.** `dsh-tool-jobs` registers no prompt section: completion notices and the job-tool descriptions carry the protocol. `dsh-web-app` registers neither `harness:source` nor `app:web-surface`; `addHarnessSourceSection` and the `HARNESS_SOURCE`/`WEB_SURFACE`/`TOOL_JOBS` order names are deleted, and `surfaceContext` now governs only the `DSH_WEB_URL` shell variable. The deployment persona's `Your working directory is {{cwd}}.` remains the only orientation line.

**Cross-tool guidance uses the shared `Advice:` style.** `web_search`, `web_fetch`, and the ui-deliverables final-response guidance render through `adviceLine`/`Advice: ` like every other tool paragraph; their scope binding follows the same presence rule (`ui:deliverable-file-references` additionally binds `present`).

## Alternatives considered

**Keep the sections, accept the fixed cost.** Rejected: the bytes are inert in tool-less scopes and the GUI orientation taught the model facts about a checkout and a dev watcher that do not exist for installed deployments.

**Platform-adaptive GUI orientation.** Rejected as speculative: no consumer distinguishes selfhosted wakeups from dev checkouts, and the orientation text is recoverable from the workspace and the live server at the point a change to the GUI is actually needed.

## Verification

Unit specs assert each section renders `''` under a scoped tool restriction and its full text once unrestricted, the claim reminder skips turns whose scope hides the claim tools, and the web-app bundle registers no prompt sections while the shell variable still fails loud without a bound port. The keyless snapshot refresh (`test:snapshot:refresh`) rewrites the session and SDK prompt sidecars to the shorter prefix, and the keyless replay verifies them with zero prompt-text divergence. The browser-driven web sidecars (`snapshots/web/*`) regenerate through `test:web:refresh`, which needs Playwright's chromium system libraries and a `DEEPSEEK_API_KEY`-free replay; on hosts without those libraries they stay stale until refreshed on a browser-capable machine.
