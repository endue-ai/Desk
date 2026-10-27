# endue Desk

English · [日本語](docs/i18n/ja/README.md) · [中文](docs/i18n/zh/README.md) ·
[Français](docs/i18n/fr/README.md) · [Deutsch](docs/i18n/de/README.md) · [한국어](docs/i18n/ko/README.md)

One app that is one OS.

**No fixed screens.** Desk is a Tauri shell and a small Rust core with a web runtime on top, and every
feature above that, the built-in ones included, is a plugin you can replace while the app is running.
Like Emacs: the core keeps only primitives (files, processes, network, audio, windows), and everything
else is code you can change without restarting.

> Status: pre-alpha. `just dev` opens the desk with Eris and the first run; start `just brain-echo` first and she answers what you type (an echo for now).

<!-- Screenshot: added with the first-run scene. -->

## Build

```bash
pnpm install
just check && just test
just dev
```

You need Rust (the version is pinned in `rust-toolchain.toml`), Node 22+, pnpm, `just` and the
Tauri prerequisites for your OS. Run `pnpm --filter @endue-ai/runtime exec playwright install webkit`
once for the runtime tests.

## Privacy

Desk has no telemetry. Crash reports, when they arrive, are opt-in and off by default.

## Learn more

- `docs/architecture.md`: how the layers fit together
- `docs/adr/`: decisions that are hard to reverse, and why
- `AGENTS.md`: the repository map, commands and rules (for people and AI agents)
- `CONTRIBUTING.md`: how to send a change

## License

Code is licensed under [Apache-2.0](LICENSE). The endue and Eris names, logos and illustrations in
`brand/` are not: see [brand/LICENSE](brand/LICENSE) and [TRADEMARK.md](TRADEMARK.md).
