---
description: "Interactive terminal mode for dsh: a single-session chat UI rendered in your terminal with live streaming, tool activity, and interactive approvals, for users who prefer the shell over the browser."
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui-app

## Summary

`dsh-tui-app` runs dsh as an interactive terminal application — the shape popularized by modern agent CLIs (a streaming transcript, inlined tool activity, a prompt that never leaves your keyboard) on top of the same `dsh-base` composition every other surface shares. Type `dsh --profile tui` and talk to the agent: answers stream in as they arrive, tool calls render as compact one-line rows with a small result preview, and permission questions ask right at the prompt instead of silently failing closed. It opens no ports, starts no browser, and needs nothing but a TTY. The main boundary: one session per invocation, rendered server-side from harness services — the React slot UI from the `web` profile stays unmounted.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Start the terminal session:

```sh
dsh --profile tui
```

Seed the first prompt from the command line, scripting-style:

```sh
dsh --profile tui "summarize README.md"
```

Inside the session:

- Type a prompt and press <kbd>Enter</kbd>. While the agent works, typed prompts queue for the next turn (<kbd>Ctrl</kbd>+<kbd>C</kbd> interrupts the running turn).
- Slash commands: `/help` lists them — `/clear` starts a fresh session, `/approval ask|never` sets the session approval policy, `/model` and `/status` show the current selection and session state, `/quit` exits.
- Approval prompts appear inline when a tool asks for a widening: `y` allows once, anything else rejects (fail-closed).
- <kbd>Ctrl</kbd>+<kbd>D</kbd> on an empty prompt (or two <kbd>Ctrl</kbd>+<kbd>C</kbd>) quits; the session log is flushed before exit.
- `NO_COLOR=1` or `--no-color` disables ANSI styling. Multiline paste is preserved through bracketed-paste mode.

<a id="understand-the-implementation"></a>
## Understand the implementation

The bundle is a patch over `dsh-base` plus two plugins, mirroring the `headless` one-shot runner's shape:

- `tui-startup` ([startup.ts](src/startup.ts)) — an ordinary `dsh-cmdline` provider that parses `--no-color`, an optional seed prompt, and the app's `--help`, then publishes them as the `tuiStartup` service that the runner row injects.
- `tui-runner` ([index.ts](src/index.ts)) — composition wiring only: composes one core Agent, subscribes to its live feeds (`agent/assistant-stream` for token deltas, `session/event` for `tool/call` / `tool/result` / turn boundaries), answers `approval/request` waterfalls interactively, and mounts the Ink render tree. All interaction semantics live in the framework-free view model [controller.ts](src/controller.ts) (transcript entries, live turn buffer, approvals, slash commands, the quit handshake); the component tree in [view.tsx](src/view.tsx) renders controller snapshots with [Ink](https://github.com/vadimdemedes/ink) (React for terminals — the repo's React 18 plane), so cursor math, wrapping, and redraw diffing come from a real engine instead of raw escape sequences.

Design notes:

- **React all the way down** — the slot-app React surface is replaced by React-for-terminals: `ink` + the repo's existing `react`/`@types/react` versions, and nothing else. The controller stays React-free so its behavior is unit-tested headlessly ([tests/controller.spec.ts](tests/controller.spec.ts)); the component layer gets a smoke suite through `ink-testing-library` ([tests/view.spec.tsx](tests/view.spec.tsx)).
- **Single-session by construction** — the `dsh-base` rows stay as shipped for the TUI (`web-app` is the surface that disables them), so the runner creates one agent and owns it until quit.
- **Fail-closed approvals** — when no TTY answerer can take a request (agent-scoped requests that are not ours), the listener delegates with `next()` so another composed answerer or the default `unavailable` decides.
- **Graceful exit** — the session log is flushed and Ink unmounts (terminal restore included) before the launcher receives the bounded `appExit` request.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Single session only; there is no `/resume <sessionId>` — resuming is Web-surface territory today.
- The keymap is intentionally small (arrows, ctrl+a/e/k/u/w, history, ctrl+j newline); no fuzzy completion or tab-complete of slash commands. Ink's parser maps both `0x08` and `0x7f` to backward-erase; erase-forward is ctrl+d on a non-empty buffer.
- Non-TTY invocations (pipes, CI) exit with a hint to use `--profile headless`, which remains the scripted surface.
- Model switching mid-session is not exposed; `/clear` keeps the current selection.

<a id="dev-note"></a>
## Dev Note

None.
