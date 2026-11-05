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

## Why Desk

Picture a builder's garage: one room where the builder works in the middle, an assistant remembers and
asks, robot arms do the work, and every wall shows the work in the shape the builder wants. Desk is that
garage, on your computer.

- **A daily tool.** Builders open it every day, so it installs, starts and answers before it does anything
  else.
- **Agent-native.** Eris, the resident secretary, keeps her own memory on this computer and orchestrates
  local and external agents. Agents have hands; the person decides.
- **Views first.** Organise data once and draw it in any shape: make your own view, let Eris make one from
  a sentence, or install one from the market.
- **Yours.** The design system, the layout and the integrations are the builder's to choose and replace.

Desk is a helper for builders: it sets up a stable environment to build in, leaves them free to shape it,
and lets them make the best product at a quality that does not waver. Where Desk stands and where it goes
is in `docs/roadmap.md`.

### Your desk is a folder

Everything you shape lives in `~/.desk`: `init.yaml`, your profiles, `keys.yaml`, your views and
`plugins.lock`, plain files you can read, edit and keep in git. `desk export <folder|file.zip>` carries
them to another computer (`--with-data` adds the desk's own state, never secrets), `desk import` brings
them back without overwriting your `init.yaml`, and `desk doctor` lists every file with whether it reads
as its spec says.

## Build

```bash
pnpm install
just check && just test
just dev
```

You need Rust (the version is pinned in `rust-toolchain.toml`), Node 22+, pnpm, `just` and the
Tauri prerequisites for your OS. On macOS the runtime tests run in a Linux container, so you also need
Docker Desktop; on Linux and Windows, run `pnpm --filter @endue-ai/runtime exec playwright install webkit`
once. Run them with `just test-e2e`, never with Playwright directly.

## Privacy

Desk has no telemetry. Crash reports, when they arrive, are opt-in and off by default.

## Learn more

- `docs/architecture.md`: how the layers fit together
- `docs/adr/`: decisions that are hard to reverse, and why
- `docs/roadmap.md`: why Desk exists, where it stands and where it goes
- `AGENTS.md`: the repository map, commands and rules (for people and AI agents)
- `CONTRIBUTING.md`: how to send a change

## License

Code is licensed under [Apache-2.0](LICENSE). The endue and Eris names, logos and illustrations in
`brand/` are not: see [brand/LICENSE](brand/LICENSE) and [TRADEMARK.md](TRADEMARK.md).
