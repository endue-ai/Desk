# endue Desk

One app that is one OS.

**No fixed screens.** Desk is a Tauri shell and a small Rust core with a web runtime on top, and every
feature above that, the built-in ones included, is a plugin you can replace while the app is running.
Like Emacs: the core keeps only primitives (files, processes, network, audio, windows), and everything
else is code you can change without restarting.

> Status: pre-alpha skeleton. There is no app to run yet. (scope-check verification edit)

<!-- Screenshot: added with the first-run scene. -->

## Build

```bash
pnpm install
just check && just test
just dev
```

You need Rust (the version is pinned in `rust-toolchain.toml`), Node 22+, pnpm and `just`.

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
