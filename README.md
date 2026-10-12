# DeepSeek Harness

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It is built on an **everything-is-a-plugin** architecture and powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512).

Documentation: [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)

## Developer preview

DeepSeek Harness is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm run dev
```

The three steps own one machine-wide pipeline (`~/.dsh/cache`, relocatable via `$DSH_HOME`):

- `pnpm install` installs the workspace dependencies and fetches the pinned vscode fork source into `cache/vscode-source/<repo>` (best-effort: when the fork is unreachable the install still succeeds — rerun `pnpm run vscode:twin:fetch` once online).
- `pnpm run build` builds the harness artifacts. Its `postbuild` hook then compiles the underlying twin dist — VS Code — by running `pnpm run vscode:twin`. The hook skips when `CI` is set. The first twin build takes ~20–40 minutes and needs node ≥ 24.18, a C/C++ toolchain, and (on Linux) libkrb5 headers — [scripts/bootstrap-vscode-twin.sh](scripts/bootstrap-vscode-twin.sh) checks each up front, skips the rebuild while the cache already carries the pinned commit, and atomically swaps the result into `cache/vscode-twin/dist`.
- `pnpm run dev` (an alias of `pnpm dsh web`) launches the built harness without rebuilding, discovering that cache slot automatically. Without a twin the vscode tab stays unavailable and the fallback editor loads.

## Community and support

- Submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## Citation

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
