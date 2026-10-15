---
description: "Boot-time host CLI detection for compositions that want the model told which command-line tools (e.g. playwright-cli) are installed, through DSH_CLI_* env facts and a prompt section."
kind: "package-reference"
---

# @deepseek-ai/dsh-cli-detection

## Summary

`dsh-cli-detection` probes a configured list of command-line tools at plugin load, using the deployment's subprocess runtime — so the same plugin works behind local and sandboxed backends. Every command that resolves is exposed to model shell calls as a managed `DSH_CLI_*` environment fact (registered with `dsh-shell-env`), and the available set is advertised in one dynamic system-prompt section placed in the shell guidance block (`CLI_DETECTION`, order 1070). Commands that fail to resolve stay invisible everywhere: no env fact, no prompt line, so the assembled prompt stays byte-stable per machine. The shipped default list probes a single tool — `playwright-cli`, the Playwright CLI browser daemon for coding agents — and deployments add more CLIs through the `tools` config field. Choose this when the model should know which host CLIs it may drive through the shell before it guesses.

## Table of Contents

- [Usage](#usage)
- [Configuration](#configuration)

<a id="usage"></a>
## Usage

The plugin is mounted by the [`dsh-base` bundle](../../bundle/base/cordis.patch.yml) beside `shell-env` and `shell-search`; no row is needed in most compositions. With `systemPrompt` mounted it contributes one section, for example:

```
Installed host CLIs, probed at session start; each resolved path is exposed to shell commands as a managed `$DSH_CLI_*` variable:
- `playwright-cli` — Playwright CLI browser daemon: `playwright-cli open <url>`, then `snapshot`/`click`/`type`.
```

and registers `DSH_CLI_PLAYWRIGHT_CLI` with the resolved executable path in every model shell call's managed environment.

<a id="configuration"></a>
## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `tools` | `{ command: string, guidance?: string }[]` | playwright-cli entry | CLIs probed at load; an empty list disables the plugin silently |

```yaml
- id: cli-detection
  name: '@deepseek-ai/dsh-cli-detection'
  config:
    tools:
      - command: playwright-cli
        guidance: 'Playwright CLI browser daemon: `playwright-cli open <url>`, then `snapshot`/`click`/`type`.'
      - command: gh
```

Two commands that derive the same `DSH_CLI_*` key (such as `pw-sh` and `pw_sh`) fail the plugin's load loudly.
